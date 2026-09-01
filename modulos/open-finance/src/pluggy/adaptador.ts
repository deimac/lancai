import { dia_provedor_iso } from "@lancai/tipos";
import { ErroProvedorIndisponivel, ErroWebhookInvalido } from "../erros";
import type {
  ContaExterna,
  EstadoConexao,
  FaturaExterna,
  LoteMovimentacoes,
  MovimentacaoExterna,
  NotificacaoFonte,
  ProvedorOpenFinance,
  ReferenciaLote,
  TokenConexao,
  WebhookInterpretado,
} from "../provedor";
import { ClientePluggy, type ConfigPluggy } from "./cliente";
import { ids_conectores_para_widget } from "./conectores-widget";
import type {
  ContaPluggy,
  FaturaPluggy,
  ItemPluggy,
  RespostaPaginada,
  TransacaoPluggy,
  WebhookPluggy,
} from "./tipos";
import {
  transacao_eh_iof_compra,
  traduzir_conta,
  traduzir_data,
  traduzir_fatura,
  traduzir_lote_transacoes,
  traduzir_motivo,
  traduzir_status_item,
} from "./traducao";

/** O Connect Token vale 30 minutos. */
const VALIDADE_TOKEN_MS = 30 * 60 * 1000;

/** A Pluggy aceita no máximo 500 identificadores por requisição. */
const MAXIMO_IDS_POR_BUSCA = 500;
/** IOF de compra internacional chega até alguns dias depois da compra. */
const JANELA_IOF_DIAS = 6;

export interface ConfigAdaptadorPluggy extends ConfigPluggy {
  /** URL do nosso webhook, repassada ao provedor na criação do token. */
  webhookUrl?: string;
}

/**
 * O único arquivo do sistema que sabe o que "Pluggy" quer dizer, junto de
 * `cliente.ts` e `traducao.ts` (ADR-011). O teste de invariante em
 * `isolamento-do-provedor.test.ts` falha se esse conhecimento escapar daqui.
 */
export class AdaptadorPluggy implements ProvedorOpenFinance {
  readonly id = "pluggy";

  private readonly cliente: ClientePluggy;
  private readonly agora: () => number;

  constructor(private readonly config: ConfigAdaptadorPluggy) {
    this.cliente = new ClientePluggy(config);
    this.agora = config.agora ?? Date.now;
  }

  async criar_token_conexao(entrada: {
    usuarioId: string;
    conexaoExterna?: string;
  }): Promise<TokenConexao> {
    const corpo = await this.cliente.postar<{ accessToken: string }>("/connect_token", {
      /** Presente só na reconexão: sem ele o widget cria um item novo. */
      ...(entrada.conexaoExterna ? { itemId: entrada.conexaoExterna } : {}),
      options: {
        /**
         * Usuário LançAI, não workspace: a conexão bancária pertence à conta
         * principal. Workspace continua só como visão/pouso técnico no schema.
         */
        clientUserId: entrada.usuarioId,
        ...(this.config.webhookUrl ? { webhookUrl: this.config.webhookUrl } : {}),
        /** O provedor recusa conectar duas vezes a mesma credencial. */
        avoidDuplicates: true,
      },
    });

    return {
      token: corpo.accessToken,
      expiraEm: new Date(this.agora() + VALIDADE_TOKEN_MS),
      conectorIds: await this.ids_conectores_do_widget(),
    };
  }

  /** Lista bancos reais; tira Meu Pluggy, que no Connect só gera erro genérico. */
  private async ids_conectores_do_widget(): Promise<number[] | undefined> {
    try {
      const corpo = await this.cliente.obter<RespostaPaginada<{ id: number; name?: string }>>(
        "/connectors",
      );
      const ids = ids_conectores_para_widget(corpo.results ?? []);
      return ids.length > 0 ? ids : undefined;
    } catch {
      return undefined;
    }
  }

  async listar_contas_externas(conexaoExterna: string): Promise<ContaExterna[]> {
    const corpo = await this.cliente.obter<RespostaPaginada<ContaPluggy>>(
      `/accounts?itemId=${encodeURIComponent(conexaoExterna)}`,
    );

    return (corpo.results ?? []).map(traduzir_conta);
  }

  /**
   * Lê extrato já materializado na Pluggy. Não chama PATCH — só GET.
   * Usado ao registrar itemId do Meu Pluggy, cujo webhook de criação já passou.
   *
   * Em `/v2/transactions` o filtro de data é `dateFrom` (não `from`/`pageSize`
   * do endpoint v1 depreciado).
   */
  async listar_referencias_historico(
    conexaoExterna: string,
    opcoes?: { lookbackDias?: number },
  ): Promise<ReferenciaLote[]> {
    const contas = await this.listar_contas_externas(conexaoExterna);
    const dias = Math.min(Math.max(Math.floor(opcoes?.lookbackDias ?? 365), 1), 365);
    const desde = new Date();
    desde.setUTCDate(desde.getUTCDate() - dias);
    const dateFrom = desde.toISOString().slice(0, 10);

    return contas.map(
      (conta) =>
        `/v2/transactions?accountId=${encodeURIComponent(conta.idExterno)}` +
        `&dateFrom=${dateFrom}`,
    );
  }

  async coletar_lote(referencia: ReferenciaLote): Promise<LoteMovimentacoes> {
    const corpo = await this.cliente.obter<RespostaPaginada<TransacaoPluggy>>(referencia);

    return {
      movimentacoes: traduzir_lote_transacoes(corpo.results ?? []),
      proxima: this.resolver_proxima(corpo.next),
    };
  }

  async coletar_faturas(contaExternaId: string): Promise<FaturaExterna[]> {
    const faturas: FaturaExterna[] = [];
    const vistas = new Set<string>();
    let caminho: string | null = `/v2/bills?accountId=${encodeURIComponent(contaExternaId)}`;

    while (caminho && !vistas.has(caminho)) {
      vistas.add(caminho);
      const corpo = await this.cliente.obter<RespostaPaginada<FaturaPluggy>>(caminho);
      for (const bruta of corpo.results ?? []) {
        const traduzida = traduzir_fatura(bruta, contaExternaId);
        if (traduzida) faturas.push(traduzida);
      }
      caminho = this.resolver_proxima(corpo.next, "/v2/bills");
    }

    return faturas;
  }

  /**
   * O provedor exige `accountId` na busca de transações, mas o webhook de
   * alteração se refere ao item. Por isso varremos as contas da conexão: buscar
   * por identificador solto não é possível na API, e adivinhar a conta a partir
   * do identificador da transação seria chute.
   */
  async coletar_por_ids(
    conexaoExterna: string,
    idsExternos: string[],
  ): Promise<MovimentacaoExterna[]> {
    if (idsExternos.length === 0) return [];

    const contas = await this.listar_contas_externas(conexaoExterna);
    const brutas = new Map<string, TransacaoPluggy>();
    const pedidos = new Set(idsExternos);

    for (const conta of contas) {
      for (const lote of this.fatiar(idsExternos, MAXIMO_IDS_POR_BUSCA)) {
        let caminho: string | null =
          `/v2/transactions?accountId=${encodeURIComponent(conta.idExterno)}` +
          `&ids=${lote.map(encodeURIComponent).join(",")}`;

        /**
         * Pagina mesmo com filtro por identificador: 500 identificadores podem
         * não caber numa página, e parar na primeira perderia o resto em
         * silêncio.
         */
        while (caminho) {
          const corpo: RespostaPaginada<TransacaoPluggy> =
            await this.cliente.obter<RespostaPaginada<TransacaoPluggy>>(caminho);

          for (const transacao of corpo.results ?? []) {
            brutas.set(transacao.id, transacao);
          }
          caminho = this.resolver_proxima(corpo.next);
        }
      }

      await this.ampliar_janela_da_compra_do_iof(conta.idExterno, brutas, pedidos);
    }

    return traduzir_lote_transacoes([...brutas.values()]);
  }

  async obter_estado(conexaoExterna: string): Promise<EstadoConexao> {
    const item = await this.cliente.obter<ItemPluggy>(
      `/items/${encodeURIComponent(conexaoExterna)}`,
    );

    const status = traduzir_status_item(item);

    return {
      status,
      ...(status === "precisa_atencao"
        ? { motivoAtencao: traduzir_motivo(item.error?.code ?? item.executionStatus) }
        : {}),
      instituicao: item.connector?.name ?? undefined,
      ultimoSyncEm: traduzir_data(item.lastUpdatedAt),
      /** Nulo é o normal: o consentimento da Pluggy não expira por padrão. */
      consentimentoExpiraEm: traduzir_data(item.consentExpiresAt),
      proximoSyncEm: traduzir_data(item.nextAutoSyncAt),
    };
  }

  /**
   * Dispara sync pontual no provedor. O Fato só chega quando o webhook anunciar
   * o lote — este método não coleta extrato (ADR-015).
   *
   * Itens **Meu Pluggy** (proxy OAuth) recusam PATCH com
   * `MeuPluggy item cant be updated`: o sync é só no app Meu Pluggy; o LançAI
   * importa via GET depois. Tratar isso como no-op, não como falha.
   */
  async solicitar_atualizacao(conexaoExterna: string): Promise<void> {
    try {
      await this.cliente.remendar(`/items/${encodeURIComponent(conexaoExterna)}`, {});
    } catch (erro) {
      if (
        erro instanceof ErroProvedorIndisponivel &&
        /MeuPluggy item cant be updated/i.test(erro.message)
      ) {
        return;
      }
      throw erro;
    }
  }

  interpretar_notificacao(corpo: unknown): WebhookInterpretado {
    if (!corpo || typeof corpo !== "object") {
      throw new ErroWebhookInvalido("corpo do webhook não é um objeto");
    }

    const webhook = corpo as WebhookPluggy;
    if (!webhook.eventId) {
      throw new ErroWebhookInvalido("webhook sem eventId");
    }
    if (!webhook.event) {
      throw new ErroWebhookInvalido("webhook sem event");
    }

    return {
      eventoId: webhook.eventId,
      tipoBruto: webhook.event,
      notificacao: this.traduzir_evento(webhook),
    };
  }

  private traduzir_evento(webhook: WebhookPluggy): NotificacaoFonte {
    const conexaoExterna = webhook.itemId;

    switch (webhook.event) {
      case "transactions/created": {
        /**
         * A ordem importa. Em aplicação criada antes de junho de 2026,
         * `createdTransactionsLink` aponta para o `/transactions` depreciado, e
         * o link de V2 vem à parte; em aplicação nova, o primeiro já é V2.
         * Preferir o V2 quando existe atende aos dois casos sem configuração.
         */
        const referencia = webhook.createdTransactionsLinkV2 ?? webhook.createdTransactionsLink;
        if (!conexaoExterna || !referencia) {
          return { tipo: "ignorada", descricao: `${webhook.event} sem link de transações` };
        }
        return { tipo: "lote_disponivel", conexaoExterna, referencia };
      }

      case "transactions/updated":
        if (!conexaoExterna || !webhook.transactionIds?.length) {
          return { tipo: "ignorada", descricao: `${webhook.event} sem transações` };
        }
        return {
          tipo: "movimentacoes_alteradas",
          conexaoExterna,
          idsExternos: webhook.transactionIds,
        };

      case "transactions/deleted":
        if (!conexaoExterna || !webhook.transactionIds?.length) {
          return { tipo: "ignorada", descricao: `${webhook.event} sem transações` };
        }
        return {
          tipo: "movimentacoes_removidas",
          conexaoExterna,
          idsExternos: webhook.transactionIds,
        };

      case "item/created":
      case "item/updated":
        if (!conexaoExterna) {
          return { tipo: "ignorada", descricao: `${webhook.event} sem itemId` };
        }
        return { tipo: "conexao_estado", conexaoExterna };

      case "item/error":
        if (!conexaoExterna) return { tipo: "ignorada", descricao: "item/error sem itemId" };
        return {
          tipo: "conexao_precisa_atencao",
          conexaoExterna,
          motivo: traduzir_motivo(webhook.error?.code),
        };

      case "item/waiting_user_input":
      case "item/waiting_user_action":
        if (!conexaoExterna) {
          return { tipo: "ignorada", descricao: `${webhook.event} sem itemId` };
        }
        return {
          tipo: "conexao_precisa_atencao",
          conexaoExterna,
          motivo: "aguardando_usuario",
        };

      case "item/deleted":
        if (!conexaoExterna) return { tipo: "ignorada", descricao: "item/deleted sem itemId" };
        return { tipo: "conexao_removida", conexaoExterna };

      default:
        /**
         * Pagamentos, investimentos e status de conector não nos interessam, mas
         * ainda assim são gravados: um evento ignorado registrado é o que permite
         * descobrir depois que ele importava.
         */
        return { tipo: "ignorada", descricao: webhook.event ?? "evento sem nome" };
    }
  }

  /**
   * O `next` vem como query string relativa ao endpoint de transações. Voltar
   * para caminho completo aqui deixa `coletar_lote` indiferente a de onde veio a
   * referência — link do webhook ou página seguinte.
   */
  private resolver_proxima(
    proxima: string | null | undefined,
    base = "/v2/transactions",
  ): string | null {
    if (!proxima) return null;
    if (proxima.startsWith("http")) return proxima;
    return proxima.startsWith("?") ? `${base}${proxima}` : proxima;
  }

  /**
   * Webhook de alteração manda só o id do IOF. Sem a compra no lote, não dá
   * para somar. Recolhe a janela da conta para o par aparecer na tradução.
   */
  private async ampliar_janela_da_compra_do_iof(
    accountId: string,
    brutas: Map<string, TransacaoPluggy>,
    pedidos: Set<string>,
  ): Promise<void> {
    const iofs = [...brutas.values()].filter(
      (transacao) =>
        transacao.accountId === accountId &&
        pedidos.has(transacao.id) &&
        transacao_eh_iof_compra(transacao),
    );
    if (iofs.length === 0) return;

    let maisAntigo: string | null = null;
    for (const iof of iofs) {
      const dia = dia_provedor_iso(iof.date);
      if (!maisAntigo || dia < maisAntigo) maisAntigo = dia;
    }
    if (!maisAntigo) return;

    const desde = recuar_dias_iso(maisAntigo, JANELA_IOF_DIAS);
    let caminho: string | null =
      `/v2/transactions?accountId=${encodeURIComponent(accountId)}` + `&dateFrom=${desde}`;

    while (caminho) {
      const corpo: RespostaPaginada<TransacaoPluggy> =
        await this.cliente.obter<RespostaPaginada<TransacaoPluggy>>(caminho);
      for (const transacao of corpo.results ?? []) {
        if (!brutas.has(transacao.id)) brutas.set(transacao.id, transacao);
      }
      caminho = this.resolver_proxima(corpo.next);
    }
  }

  private *fatiar<T>(itens: T[], tamanho: number): Generator<T[]> {
    for (let inicio = 0; inicio < itens.length; inicio += tamanho) {
      yield itens.slice(inicio, inicio + tamanho);
    }
  }
}

function recuar_dias_iso(dia: string, dias: number): string {
  const data = new Date(`${dia}T00:00:00.000Z`);
  data.setUTCDate(data.getUTCDate() - dias);
  return data.toISOString().slice(0, 10);
}
