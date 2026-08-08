import { ErroWebhookInvalido } from "../erros";
import type {
  ContaExterna,
  EstadoConexao,
  LoteMovimentacoes,
  MovimentacaoExterna,
  NotificacaoFonte,
  ProvedorOpenFinance,
  ReferenciaLote,
  TokenConexao,
  WebhookInterpretado,
} from "../provedor";
import { ClientePluggy, type ConfigPluggy } from "./cliente";
import type {
  ContaPluggy,
  ItemPluggy,
  RespostaPaginada,
  TransacaoPluggy,
  WebhookPluggy,
} from "./tipos";
import {
  traduzir_conta,
  traduzir_data,
  traduzir_motivo,
  traduzir_status_item,
  traduzir_transacao,
} from "./traducao";

/** O Connect Token vale 30 minutos. */
const VALIDADE_TOKEN_MS = 30 * 60 * 1000;

/** A Pluggy aceita no máximo 500 identificadores por requisição. */
const MAXIMO_IDS_POR_BUSCA = 500;

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
    workspaceId: string;
    conexaoExterna?: string;
  }): Promise<TokenConexao> {
    const corpo = await this.cliente.postar<{ accessToken: string }>("/connect_token", {
      /** Presente só na reconexão: sem ele o widget cria um item novo. */
      ...(entrada.conexaoExterna ? { itemId: entrada.conexaoExterna } : {}),
      options: {
        /**
         * O workspace, não o usuário: é ele que delimita os dados (ADR-013), e
         * na F6 a mesma conexão é vista por mais de uma pessoa.
         */
        clientUserId: entrada.workspaceId,
        ...(this.config.webhookUrl ? { webhookUrl: this.config.webhookUrl } : {}),
        /** O provedor recusa conectar duas vezes a mesma credencial. */
        avoidDuplicates: true,
      },
    });

    return { token: corpo.accessToken, expiraEm: new Date(this.agora() + VALIDADE_TOKEN_MS) };
  }

  async listar_contas_externas(conexaoExterna: string): Promise<ContaExterna[]> {
    const corpo = await this.cliente.obter<RespostaPaginada<ContaPluggy>>(
      `/accounts?itemId=${encodeURIComponent(conexaoExterna)}`,
    );

    return (corpo.results ?? []).map(traduzir_conta);
  }

  async coletar_lote(referencia: ReferenciaLote): Promise<LoteMovimentacoes> {
    const corpo = await this.cliente.obter<RespostaPaginada<TransacaoPluggy>>(referencia);

    return {
      movimentacoes: (corpo.results ?? []).map(traduzir_transacao),
      proxima: this.resolver_proxima(corpo.next),
    };
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
    const encontradas = new Map<string, MovimentacaoExterna>();

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
            encontradas.set(transacao.id, traduzir_transacao(transacao));
          }
          caminho = this.resolver_proxima(corpo.next);
        }
      }
    }

    return [...encontradas.values()];
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
   */
  async solicitar_atualizacao(conexaoExterna: string): Promise<void> {
    await this.cliente.remendar(`/items/${encodeURIComponent(conexaoExterna)}`, {});
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
  private resolver_proxima(proxima: string | null | undefined): string | null {
    if (!proxima) return null;
    if (proxima.startsWith("http")) return proxima;
    return proxima.startsWith("?") ? `/v2/transactions${proxima}` : proxima;
  }

  private *fatiar<T>(itens: T[], tamanho: number): Generator<T[]> {
    for (let inicio = 0; inicio < itens.length; inicio += tamanho) {
      yield itens.slice(inicio, inicio + tamanho);
    }
  }
}
