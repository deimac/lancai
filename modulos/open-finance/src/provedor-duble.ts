import {
  ErroConexaoExternaInexistente,
  ErroProvedorIndisponivel,
  ErroWebhookInvalido,
} from "./erros";
import type {
  ContaExterna,
  EstadoConexao,
  FaturaExterna,
  LoteMovimentacoes,
  MotivoAtencao,
  MovimentacaoExterna,
  ProvedorOpenFinance,
  TokenConexao,
  WebhookInterpretado,
} from "./provedor";

/**
 * O corpo que este dublê aceita no webhook. É de propósito diferente do formato
 * da Pluggy: se um teste passar aqui e falhar no adaptador real, o problema está
 * no adaptador, não no serviço. Um formato só provaria menos.
 */
interface CorpoWebhookDuble {
  eventoId: string;
  evento: string;
  conexao?: string;
  referencia?: string;
  idsExternos?: string[];
  motivo?: MotivoAtencao;
}

/**
 * Provedor de mentira, em memória. Existe para provar o fluxo de ingestão ponta a
 * ponta antes de haver contrato assinado com um provedor de verdade — e depois
 * continua útil, porque o sandbox da Pluggy entrega dado ilustrativo, que não
 * serve de fixture de teste automatizado.
 */
export class ProvedorDuble implements ProvedorOpenFinance {
  readonly id: string;

  private readonly movimentacoes = new Map<string, MovimentacaoExterna[]>();
  private readonly contas = new Map<string, ContaExterna[]>();
  private readonly estados = new Map<string, EstadoConexao>();
  private readonly faturas = new Map<string, FaturaExterna[]>();

  /** Chamadas registradas, para o teste afirmar que a paginação parou onde devia. */
  readonly lotesColetados: string[] = [];

  /** Contas de cartão das quais pediram faturas fechadas. */
  readonly faturasColetadas: string[] = [];

  /** Conexões para as quais pediram “atualizar agora”. */
  readonly atualizacoesPedidas: string[] = [];

  /** Quando true, `solicitar_atualizacao` falha (simula 409 da Pluggy). */
  falharAtualizacao = false;

  /** Quando true, GET de contas/estado falha como 5xx (não como item apagado). */
  falharLeitura = false;

  /** ItemIds que o provedor trata como apagados (GET 404). */
  private readonly inexistentes = new Set<string>();

  constructor(
    private readonly opcoes: { id?: string; tamanhoPagina?: number } = {},
  ) {
    this.id = opcoes.id ?? "duble";
  }

  private get tamanhoPagina(): number {
    return this.opcoes.tamanhoPagina ?? 500;
  }

  // ----- montagem do cenário -----

  semear(conexaoExterna: string, movimentacoes: MovimentacaoExterna[]): void {
    const atuais = this.movimentacoes.get(conexaoExterna) ?? [];
    this.movimentacoes.set(conexaoExterna, [...atuais, ...movimentacoes]);
  }

  registrarContas(conexaoExterna: string, contas: ContaExterna[]): void {
    this.contas.set(conexaoExterna, contas);
  }

  semear_faturas(contaExternaId: string, faturas: FaturaExterna[]): void {
    this.faturas.set(contaExternaId, faturas);
  }

  /** O corpo que o provedor mandaria ao anunciar movimentações novas. */
  anunciar_lote(conexaoExterna: string, eventoId: string): CorpoWebhookDuble {
    return {
      eventoId,
      evento: "lote_disponivel",
      conexao: conexaoExterna,
      referencia: `${conexaoExterna}#0`,
    };
  }

  anunciar_alteracao(
    conexaoExterna: string,
    eventoId: string,
    idsExternos: string[],
  ): CorpoWebhookDuble {
    return { eventoId, evento: "movimentacoes_alteradas", conexao: conexaoExterna, idsExternos };
  }

  anunciar_remocao(
    conexaoExterna: string,
    eventoId: string,
    idsExternos: string[],
  ): CorpoWebhookDuble {
    return { eventoId, evento: "movimentacoes_removidas", conexao: conexaoExterna, idsExternos };
  }

  anunciar_atencao(
    conexaoExterna: string,
    eventoId: string,
    motivo: MotivoAtencao,
  ): CorpoWebhookDuble {
    return { eventoId, evento: "conexao_precisa_atencao", conexao: conexaoExterna, motivo };
  }

  anunciar_estado(conexaoExterna: string, eventoId: string): CorpoWebhookDuble {
    return { eventoId, evento: "conexao_estado", conexao: conexaoExterna };
  }

  definir_estado(conexaoExterna: string, estado: EstadoConexao): void {
    this.estados.set(conexaoExterna, estado);
  }

  /** Simula item apagado no provedor (GET 404). */
  marcar_inexistente(conexaoExterna: string): void {
    this.inexistentes.add(conexaoExterna);
  }

  private exigir_existente(conexaoExterna: string): void {
    if (this.inexistentes.has(conexaoExterna)) {
      throw new ErroConexaoExternaInexistente(
        `GET /items/${conexaoExterna} devolveu HTTP 404`,
      );
    }
  }

  // ----- a porta -----

  interpretar_notificacao(corpo: unknown): WebhookInterpretado {
    if (typeof corpo !== "object" || corpo === null) {
      throw new ErroWebhookInvalido("corpo não é um objeto");
    }

    const { eventoId, evento, conexao, referencia, idsExternos, motivo } =
      corpo as Partial<CorpoWebhookDuble>;

    if (!eventoId) throw new ErroWebhookInvalido("sem eventoId");
    if (!evento) throw new ErroWebhookInvalido("sem evento");

    const envelope = { eventoId, tipoBruto: evento };

    switch (evento) {
      case "lote_disponivel":
        if (!conexao || !referencia) throw new ErroWebhookInvalido("lote sem conexão ou referência");
        return { ...envelope, notificacao: { tipo: "lote_disponivel", conexaoExterna: conexao, referencia } };

      case "movimentacoes_alteradas":
        if (!conexao) throw new ErroWebhookInvalido("alteração sem conexão");
        return {
          ...envelope,
          notificacao: {
            tipo: "movimentacoes_alteradas",
            conexaoExterna: conexao,
            idsExternos: idsExternos ?? [],
          },
        };

      case "movimentacoes_removidas":
        if (!conexao) throw new ErroWebhookInvalido("remoção sem conexão");
        return {
          ...envelope,
          notificacao: {
            tipo: "movimentacoes_removidas",
            conexaoExterna: conexao,
            idsExternos: idsExternos ?? [],
          },
        };

      case "conexao_precisa_atencao":
        if (!conexao || !motivo) throw new ErroWebhookInvalido("atenção sem conexão ou motivo");
        return {
          ...envelope,
          notificacao: { tipo: "conexao_precisa_atencao", conexaoExterna: conexao, motivo },
        };

      case "conexao_removida":
        if (!conexao) throw new ErroWebhookInvalido("remoção de conexão sem conexão");
        return { ...envelope, notificacao: { tipo: "conexao_removida", conexaoExterna: conexao } };

      case "conexao_estado":
        if (!conexao) throw new ErroWebhookInvalido("estado sem conexão");
        return { ...envelope, notificacao: { tipo: "conexao_estado", conexaoExterna: conexao } };

      default:
        return { ...envelope, notificacao: { tipo: "ignorada", descricao: evento } };
    }
  }

  async coletar_lote(referencia: string): Promise<LoteMovimentacoes> {
    this.lotesColetados.push(referencia);

    const separador = referencia.lastIndexOf("#");
    if (separador < 0) throw new ErroWebhookInvalido(`referência malformada: ${referencia}`);

    const conexaoExterna = referencia.slice(0, separador);
    const inicio = Number(referencia.slice(separador + 1));
    if (!Number.isInteger(inicio) || inicio < 0) {
      throw new ErroWebhookInvalido(`referência malformada: ${referencia}`);
    }

    const todas = this.movimentacoes.get(conexaoExterna) ?? [];
    const fim = inicio + this.tamanhoPagina;

    return {
      movimentacoes: todas.slice(inicio, fim),
      proxima: fim < todas.length ? `${conexaoExterna}#${fim}` : null,
    };
  }

  async coletar_faturas(contaExternaId: string): Promise<FaturaExterna[]> {
    this.faturasColetadas.push(contaExternaId);
    return this.faturas.get(contaExternaId) ?? [];
  }

  async coletar_por_ids(
    conexaoExterna: string,
    idsExternos: string[],
  ): Promise<MovimentacaoExterna[]> {
    const procurados = new Set(idsExternos);
    const todas = this.movimentacoes.get(conexaoExterna) ?? [];
    return todas.filter((m) => procurados.has(m.idExterno));
  }

  async listar_contas_externas(conexaoExterna: string): Promise<ContaExterna[]> {
    this.exigir_existente(conexaoExterna);
    if (this.falharLeitura) {
      throw new ErroProvedorIndisponivel("GET /accounts devolveu HTTP 500");
    }
    return this.contas.get(conexaoExterna) ?? [];
  }

  async listar_referencias_historico(
    conexaoExterna: string,
    _opcoes?: { lookbackDias?: number },
  ): Promise<string[]> {
    this.exigir_existente(conexaoExterna);
    const todas = this.movimentacoes.get(conexaoExterna) ?? [];
    return todas.length > 0 ? [`${conexaoExterna}#0`] : [];
  }

  async criar_token_conexao(entrada: { usuarioId: string }): Promise<TokenConexao> {
    return {
      token: `duble-token-${entrada.usuarioId}`,
      expiraEm: new Date(Date.now() + 30 * 60 * 1000),
    };
  }

  async obter_estado(conexaoExterna: string): Promise<EstadoConexao> {
    this.exigir_existente(conexaoExterna);
    if (this.falharLeitura) {
      throw new ErroProvedorIndisponivel("GET /items devolveu HTTP 500");
    }
    return (
      this.estados.get(conexaoExterna) ?? {
        status: "ativa",
        instituicao: "Banco de Mentira",
        consentimentoExpiraEm: null,
      }
    );
  }

  async solicitar_atualizacao(conexaoExterna: string): Promise<void> {
    this.exigir_existente(conexaoExterna);
    if (this.falharAtualizacao) {
      throw new ErroProvedorIndisponivel("PATCH /items devolveu HTTP 409");
    }
    this.atualizacoesPedidas.push(conexaoExterna);
    this.estados.set(conexaoExterna, {
      ...(await this.obter_estado(conexaoExterna)),
      status: "sincronizando",
    });
  }
}
