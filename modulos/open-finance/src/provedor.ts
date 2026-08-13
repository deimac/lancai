import type { ParcelamentoFonte, StatusFonte } from "@lancai/tipos";

/**
 * Ponteiro opaco para uma página de movimentações no provedor. Pode ser um
 * cursor, uma URL ou um token — só o adaptador sabe, e é justamente por isso
 * que é `string` sem estrutura: dar forma a isso aqui seria deixar o desenho de
 * paginação de um provedor vazar para o módulo.
 */
export type ReferenciaLote = string;

/** Estado de uma conexão em vocabulário nosso, não do provedor. */
export type StatusConexao = "ativa" | "sincronizando" | "precisa_atencao" | "removida";

export type MotivoAtencao =
  | "credencial_invalida"
  | "consentimento_revogado"
  | "aguardando_usuario"
  | "erro_no_provedor";

/**
 * Uma linha de extrato como a instituição a entregou, já traduzida do formato do
 * provedor mas ainda **sem** os identificadores locais.
 *
 * Não é `EventoFinanceiroNormalizado` porque o adaptador não tem como saber o
 * `workspaceId` nem o `contaId`: ele conhece a conta pelo identificador do
 * provedor. Quem completa é o serviço de ingestão, consultando o mapa de contas.
 * Só ali o evento fica pronto para o Core.
 */
export interface MovimentacaoExterna {
  /** Identificador na instituição. Chave de deduplicação do Core. */
  idExterno: string;
  /** Conta no provedor. O mapa do módulo traduz para conta ou cartão local. */
  contaExternaId: string;
  /** Data no formato YYYY-MM-DD. */
  ocorridoEm: string;
  /** Sempre positivo. A direção está em `tipo`. */
  valor: number;
  tipo: "receita" | "despesa";
  descricaoFonte: string;
  favorecidoFonte?: string;
  statusFonte: StatusFonte;
  /** Só compra parcelada no cartão traz. Cada parcela chega como transação própria. */
  parcelamento?: ParcelamentoFonte;
}

/**
 * Uma página de movimentações. `proxima` nula significa fim do lote — a Pluggy
 * traz 500 por página e a criação de uma conexão importa até 365 dias, então
 * paginar não é caso raro.
 */
export interface LoteMovimentacoes {
  movimentacoes: MovimentacaoExterna[];
  proxima: ReferenciaLote | null;
}

/** Conta ou cartão encontrado numa conexão, para o usuário associar ao que é local. */
export interface ContaExterna {
  idExterno: string;
  nome: string;
  /** Tipo como o provedor chama. Opaco de propósito. */
  tipo: string;
  /** Saldo informado pela instituição — Fato (conta: disponível; cartão: em aberto). */
  saldo?: number;
  /** Limite total do cartão, quando a instituição informa. */
  limite?: number;
  /** Dia do mês de fechamento da fatura (1–31). */
  fechamento?: number;
  /** Dia do mês de vencimento da fatura (1–31). */
  vencimento?: number;
}

export interface EstadoConexao {
  status: StatusConexao;
  motivoAtencao?: MotivoAtencao;
  instituicao?: string;
  ultimoSyncEm?: Date | null;
  /** Nulo significa consentimento sem expiração, que é o padrão. */
  consentimentoExpiraEm?: Date | null;
  /** Quando o provedor pretende sincronizar de novo. Só observabilidade. */
  proximoSyncEm?: Date | null;
}

export interface TokenConexao {
  token: string;
  expiraEm: Date;
  /**
   * IDs de instituições que o widget deve listar. Sem isto o provedor mostra
   * tudo, inclusive atalhos que não são banco (ex.: Meu Pluggy).
   */
  conectorIds?: number[];
}

/**
 * O que um webhook quer dizer, em termos nossos. Os nomes de evento do provedor
 * param na tradução: nenhum `if (evento === "transactions/created")` deve existir
 * fora do adaptador.
 */
export type NotificacaoFonte =
  /** Há movimentações novas para buscar em `referencia`. É a porta principal. */
  | { tipo: "lote_disponivel"; conexaoExterna: string; referencia: ReferenciaLote }
  /** Movimentações já ingeridas mudaram na instituição — tipicamente pendente virou confirmada. */
  | { tipo: "movimentacoes_alteradas"; conexaoExterna: string; idsExternos: string[] }
  /** A instituição removeu movimentações que já viraram Fato aqui. Ver seção 8.6 de 13-OPEN_FINANCE.md. */
  | { tipo: "movimentacoes_removidas"; conexaoExterna: string; idsExternos: string[] }
  /**
   * Item criado/atualizado no provedor — só sincroniza estado se a conexão já
   * estiver registrada (widget → POST /conexoes). Não cria conexão sozinho.
   */
  | { tipo: "conexao_estado"; conexaoExterna: string }
  | { tipo: "conexao_precisa_atencao"; conexaoExterna: string; motivo: MotivoAtencao }
  | { tipo: "conexao_removida"; conexaoExterna: string }
  /** Evento que o provedor manda e não nos interessa. Registrado, não processado. */
  | { tipo: "ignorada"; descricao: string };

/**
 * O webhook lido, pronto para ser gravado antes de qualquer processamento.
 * `eventoId` é o que torna a retentativa do provedor inofensiva — a Pluggy manda
 * até nove vezes o mesmo evento.
 */
export interface WebhookInterpretado {
  eventoId: string;
  /** Nome do evento como o provedor manda. Guardado cru junto do payload. */
  tipoBruto: string;
  notificacao: NotificacaoFonte;
}

/**
 * A porta que todo provedor de Open Finance implementa. É a única superfície do
 * módulo que conhece um provedor concreto (ADR-011), e não tem método de "buscar
 * o que há de novo desde X" de propósito: a ingestão é reativa, o provedor é
 * dono do sync e anuncia o lote (ADR-015).
 */
export interface ProvedorOpenFinance {
  /** Rótulo gravado em `provedor`. Opaco para todo mundo. */
  readonly id: string;

  /**
   * Token de curta duração que o Web usa para abrir o widget. Não lê dados.
   * `usuarioId` vira `clientUserId` no provedor — a conexão bancária pertence
   * ao usuário; workspace é só visão/pouso técnico no schema atual.
   */
  criar_token_conexao(entrada: { usuarioId: string; conexaoExterna?: string }): Promise<TokenConexao>;

  /** Contas e cartões de uma conexão, para o usuário associar às contas locais. */
  listar_contas_externas(conexaoExterna: string): Promise<ContaExterna[]>;

  /**
   * Referências para ler o extrato **já coletado** no provedor (GET), sem
   * disparar sync com o banco. Necessário ao registrar um itemId existente
   * (Meu Pluggy): o histórico não chega de novo por webhook.
   *
   * `lookbackDias` limita `dateFrom` (padrão do adaptador: 365). Cron usa
   * janela menor; primeira sync / “Atualizar agora” costuma pedir o máximo.
   */
  listar_referencias_historico(
    conexaoExterna: string,
    opcoes?: { lookbackDias?: number },
  ): Promise<ReferenciaLote[]>;

  /** Traduz a página que o webhook anunciou. O cursor vem do provedor. */
  coletar_lote(referencia: ReferenciaLote): Promise<LoteMovimentacoes>;

  /** Busca movimentações específicas, para o caso de alteração na instituição. */
  coletar_por_ids(conexaoExterna: string, idsExternos: string[]): Promise<MovimentacaoExterna[]>;

  /** Estado da conexão para a observabilidade da seção 7 de 13-OPEN_FINANCE.md. */
  obter_estado(conexaoExterna: string): Promise<EstadoConexao>;

  /**
   * Pede ao provedor uma sincronização pontual desta conexão (“atualizar agora”).
   * Não importa Fato: o resultado chega depois por webhook (ADR-015).
   */
  solicitar_atualizacao(conexaoExterna: string): Promise<void>;

  /**
   * Lê o webhook. É pura e sem I/O, porque roda antes de gravar o evento bruto:
   * é dela que sai o `eventoId` usado para descartar retentativa.
   */
  interpretar_notificacao(corpo: unknown): WebhookInterpretado;
}
