import type { IntencaoDetectada, Perfil } from "@lancai/tipos";

/**
 * Se o front abre por IP da LAN/VPN (ex.: 192.168.x.x:5173) mas VITE_API_URL
 * aponta para localhost, o browser bloqueia (CORS / rede). Alinha o host.
 */
function resolver_url_api(): string {
  const configurada = (import.meta.env.VITE_API_URL ?? "http://localhost:3333").replace(/\/$/, "");
  if (typeof window === "undefined") return configurada;
  try {
    const api = new URL(configurada);
    const hostPagina = window.location.hostname;
    const apiLocal = api.hostname === "localhost" || api.hostname === "127.0.0.1";
    const paginaLocal = hostPagina === "localhost" || hostPagina === "127.0.0.1";
    if (apiLocal && !paginaLocal) {
      api.hostname = hostPagina;
      return api.origin;
    }
  } catch {
    /* mantém configurada */
  }
  return configurada;
}

const URL_BASE = resolver_url_api();

export type OrigemFinanceira = "manual" | "open_finance";

export type StatusConexao = "ativa" | "sincronizando" | "precisa_atencao" | "removida";

export interface ContaResumo {
  id: string;
  nome: string;
  saldoAtual: string;
  saldoInicial?: string;
  perfil: Perfil;
  /** Conta ligada ao Open Finance — Fato imutável. */
  sincronizada?: boolean;
  /** Derivado do mapa Open Finance — `manual` ou `open_finance`. */
  origem?: OrigemFinanceira;
  conexaoId?: string | null;
  instituicao?: string | null;
  idExterno?: string | null;
  conexaoStatus?: StatusConexao | null;
  ultimoSyncEm?: string | null;
  workspaceId?: string;
  workspaceNome?: string | null;
  ativo?: boolean;
}

export interface CartaoResumo {
  id: string;
  nome: string;
  limite: string;
  /** Saldo devido do cartão. */
  saldo?: string;
  perfil: Perfil;
  modalidade: "credito" | "debito" | "multiplo";
  fechamento?: number;
  vencimento: number;
  melhorDiaCompra?: number;
  /** Cartão ligado ao Open Finance — Fato imutável. */
  sincronizada?: boolean;
  origem?: OrigemFinanceira;
  conexaoId?: string | null;
  instituicao?: string | null;
  idExterno?: string | null;
  conexaoStatus?: StatusConexao | null;
  ultimoSyncEm?: string | null;
  workspaceId?: string;
  workspaceNome?: string | null;
  contaId?: string | null;
  /** True quando há blob de plástico salvo (sem revelar dados). */
  temPlastico?: boolean;
  /** Últimos 4 dígitos derivados na leitura (decifragem do blob); não é coluna. */
  final4?: string | null;
  faturasOficiais?: Array<{ competencia: string; total: number }>;
}

export type TipoDestinoPdf = "conta" | "cartao";

export type DestinoPdf = {
  tipo: TipoDestinoPdf;
  id: string;
  nome: string;
};

export type ParcelamentoPdf = {
  numero: number;
  total: number;
  valorTotal?: number;
  compraEm?: string;
};

export type LinhaPreviewPdf = {
  ocorridoEm: string;
  descricao: string;
  valor: number;
  tipo: "receita" | "despesa";
  destinoSugerido: TipoDestinoPdf;
  destino: DestinoPdf | null;
  aceita: boolean;
  parcelamento?: ParcelamentoPdf;
};

export type PreviewImportacaoPdf = {
  arquivoHash: string;
  provedor: string;
  origem: DestinoPdf;
  par: DestinoPdf | null;
  candidatosPar: DestinoPdf[];
  precisaSegundoDestino: boolean;
  textoInsuficiente: boolean;
  aviso?: string;
  linhas: LinhaPreviewPdf[];
};

export type ResultadoConfirmarPdf = {
  criados: number;
  duplicados: number;
};

export type TipoCategoria = "receita" | "despesa" | "ambos";

export interface CategoriaResumo {
  id: string;
  nome: string;
  tipo: TipoCategoria;
  ativo?: boolean;
  icone?: string;
  cor?: string;
  sistema?: boolean;
  limite?: number | null;
  gastoMes?: number;
  percentual?: number | null;
  movimentosMes?: number;
}

export type OrigemRegra = "manual" | "aprendizado_conversa";
export type LogicaCondicoesRegra = "e" | "ou";
export type CampoCondicaoRegra =
  | "descricao"
  | "valor"
  | "data"
  | "tipo"
  | "conta"
  | "cartao";
export type OperadorCondicaoRegra =
  | "comeca_com"
  | "contem"
  | "nao_contem"
  | "igual"
  | "diferente"
  | "termina_com"
  | "regex";

export type CondicaoRegraApi = {
  campo: CampoCondicaoRegra;
  operador: OperadorCondicaoRegra;
  valor: string;
};

export type AcaoRegraApi =
  | { tipo: "definir_categoria"; categoriaId: string }
  | { tipo: "definir_beneficiario"; pessoaId: string }
  | { tipo: "adicionar_tags_notas"; tags?: string[]; observacoes?: string }
  | { tipo: "ignorar_transacao" }
  | { tipo: "definir_perfil"; perfil: Perfil }
  | { tipo: "marcar_pagamento_fatura" };

export interface RegraResumo {
  id: string;
  nome: string;
  origem: OrigemRegra;
  ativa: boolean;
  logicaCondicoes: LogicaCondicoesRegra;
  condicoes: CondicaoRegraApi[];
  acoes: AcaoRegraApi[];
  categoriaId: string | null;
  categoriaNome: string | null;
  dataCriacao: string;
}

export interface PessoaResumo {
  id: string;
  nome: string;
}

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  whatsappNumero: string | null;
  /** Preferência do painel do assistente — sincronizada no backend. */
  posicaoPainel?: "lateral" | "inferior";
  workspaceAtivoId?: string | null;
  ativo?: boolean;
}

export type CorWorkspace =
  | "violet"
  | "blue"
  | "teal"
  | "orange"
  | "red"
  | "pink"
  | "indigo"
  | "slate";

export interface WorkspaceResumo {
  id: string;
  nome: string;
  descricao: string | null;
  cor: CorWorkspace | string;
  ativo: boolean;
  sintetico?: boolean;
  quantidadeContas?: number;
  quantidadeCartoes?: number;
}

export interface MensagemChat {
  id: string;
  papel: "usuario" | "sistema" | "ia";
  conteudo: string;
  dataCriacao: string;
}

export interface RespostaChat {
  sessaoId: string;
  intencao?: IntencaoDetectada;
  resposta: string;
  pipeline?: PipelineAssistente;
}

export type PipelineAssistente = "v3" | "v2" | "legado";

/**
 * O que a tela sabe sobre a Fonte. `id` é rótulo opaco: serve só para escolher
 * qual widget carregar, e nenhuma linha do web decide nada olhando o valor dele.
 */
export interface DescritorFonte {
  id?: string;
  disponivel: boolean;
}

export interface TokenConexao {
  token: string;
  expiraEm: string;
  conectorIds?: number[];
}

export type MotivoAtencao =
  | "credencial_invalida"
  | "consentimento_revogado"
  | "aguardando_usuario"
  | "erro_no_provedor";

export interface ResumoIngestaoUi {
  criados: number;
  duplicados: number;
  atualizados: number;
  removidos: number;
  semDestino: number;
  paginas: number;
}

export interface RecursosVinculadosUi {
  quantidade: number;
  nomes: string[];
}

export interface ConexaoDetalhada {
  id: string;
  idExterno: string;
  status: StatusConexao;
  instituicao: string | null;
  motivoAtencao: MotivoAtencao | null;
  ultimoSyncEm: string | null;
  consentimentoExpiraEm: string | null;
  ultimoResumoIngestao: ResumoIngestaoUi | null;
  contasVinculadas?: RecursosVinculadosUi;
  cartoesVinculados?: RecursosVinculadosUi;
}

export interface ContaExternaRegistrada {
  contaExternaId: string;
  nome: string;
  tipo: string;
  contaId: string | null;
  cartaoId: string | null;
}

/** Recurso visto no provedor antes de registrar (inspecionar / reatachar). */
export interface ContaExternaPreview {
  idExterno: string;
  nome: string;
  tipo: string;
  saldo?: number;
  limite?: number;
}

export interface InspecaoItemOf {
  instituicao: string | null;
  status: StatusConexao;
  contas: ContaExternaPreview[];
}

export type PareamentoReatachar = {
  contaExternaId: string;
  contaId?: string;
  cartaoId?: string;
};

export interface ResumoReatachar {
  criados: number;
  duplicados: number;
  atualizados?: number;
  puladosSemanticos?: number;
  semDestino: number;
  paginas: number;
}

export interface ConexaoComContas {
  conexao: ConexaoDetalhada;
  contas: ContaExternaRegistrada[];
}

export interface ProgressoImportacaoApi {
  percentual: number;
  mensagem: string;
  criados: number;
  duplicados: number;
  contaAtual: number;
  contasTotal: number;
}

type EventoAtualizarConexao =
  | ({ tipo: "progresso" } & ProgressoImportacaoApi)
  | {
      tipo: "fim";
      detalhe: ConexaoComContas;
      resumo: ResumoReatachar;
    }
  | { tipo: "erro"; erro: string; conexaoDesconectada?: boolean };

function evento_ndjson(texto: string): EventoAtualizarConexao | null {
  const linha = texto.trim();
  if (!linha) return null;
  try {
    return JSON.parse(linha) as EventoAtualizarConexao;
  } catch {
    return null;
  }
}

/** Consome NDJSON e para no `fim`/`erro`, sem esperar o socket fechar. */
async function ler_stream_ndjson(
  corpo: ReadableStream<Uint8Array>,
  aoEvento: (evento: EventoAtualizarConexao) => void,
): Promise<void> {
  const leitor = corpo.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const aplicar = (evento: EventoAtualizarConexao): boolean => {
    aoEvento(evento);
    return evento.tipo === "fim" || evento.tipo === "erro";
  };

  try {
    while (true) {
      const { done, value } = await leitor.read();
      if (done) {
        buffer += decoder.decode();
        for (const linha of buffer.split("\n")) {
          const evento = evento_ndjson(linha);
          if (evento && aplicar(evento)) return;
        }
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const linhas = buffer.split("\n");
      buffer = linhas.pop() ?? "";
      for (const linha of linhas) {
        const evento = evento_ndjson(linha);
        if (evento && aplicar(evento)) return;
      }
    }
  } finally {
    await leitor.cancel().catch(() => undefined);
  }
}

export interface DashboardCartao {
  id: string;
  nome: string;
  perfil: string;
  limite: number;
  comprometido: number;
  disponivel: number;
  fechamento: number;
  vencimento: number;
  sincronizada: boolean;
  instituicao: string | null;
  final4: string | null;
  gastoMes: number;
  quantidadeLancamentos: number;
  gastoEhFaturaAtual?: boolean;
  competenciaCiclo?: string;
  cicloInicio?: string;
  cicloFim?: string;
  totalOficial?: number | null;
  ajusteFatura?: number | null;
}

export interface RankingCategoria {
  categoriaNome: string;
  total: number;
  icone?: string;
  cor?: string;
}

export interface ProximoPagamento {
  id: string;
  data: string;
  descricao: string;
  valor: number;
  origem: "previsto" | "parcela" | "fatura" | "recorrente";
  contaNome: string | null;
  vencida: boolean;
  pago?: boolean;
  dataPagamento?: string | null;
  competenciaCiclo?: string | null;
  situacao?: "aberta" | "a_pagar" | "paga" | "vencida";
}

export interface OrcamentoDashboard {
  categoriaNome: string | null;
  gasto: number;
  limite: number;
  percentual: number;
  icone?: string;
  cor?: string;
}

export interface DashboardResposta {
  mes: string;
  periodo: { de: string; ate: string };
  resumo: {
    saldoTotal: number;
    quantidadeContas: number;
    cartoesUsado: number;
    cartoesDisponivel: number;
    cartoesLimite: number;
    quantidadeCartoes: number;
    percentualUtilizadoCartoes: number | null;
    gastoCartoesMes: number;
    quantidadeLancamentosCartoesMes: number;
    receitasMes: number;
    despesasMes: number;
    resultadoMes: number;
    saldoPeriodo: number;
    variacaoReceitas?: number | null;
    variacaoDespesas?: number | null;
    variacaoResultado?: number | null;
  };
  tipoGasto?: "pf" | "pj" | null;
  natureza?: {
    pessoal: { receitas: number; despesas: number; resultado: number };
    empresa: { receitas: number; despesas: number; resultado: number };
  };
  cruzamento?: {
    totalPessoalComEmpresa: number;
    totalEmpresaComPessoal: number;
  } | null;
  naoClassificado: { quantidade: number; total: number };
  gastosPorCategoria: RankingCategoria[];
  receitasPorCategoria?: RankingCategoria[];
  fluxoSaldo: Array<{ data: string; saldo: number }>;
  fluxoResultado?: Array<{
    data: string;
    entradas: number;
    saidas: number;
    resultado: number;
    resultadoAcumulado?: number;
  }>;
  recentes: Array<{
    id: string;
    data: string;
    descricao: string;
    valor: number;
    tipo: string;
    categoriaNome: string | null;
    origemNome: string | null;
    icone?: string;
    cor?: string;
  }>;
  proximosPagamentos?: ProximoPagamento[];
  orcamentos?: OrcamentoDashboard[];
  contas: Array<{ nome: string; perfil: string; saldoAtual: number }>;
  cartoes: DashboardCartao[];
}

export type ClassificadoPor = "regra" | "ia" | "usuario";

/** Linha do extrato com Conhecimento para classificação na UI. */
export interface MovimentoResumo {
  id: string;
  descricao: string;
  descricaoFonte: string;
  valor: string;
  tipo: string;
  status: "previsto" | "realizado" | "cancelado";
  fonte: string;
  provedor: string | null;
  idExterno: string | null;
  dataMovimento: string;
  /** ISO da instituição, quando há hora além do dia. */
  ocorridoEmInstante?: string | null;
  contaId: string | null;
  cartaoId: string | null;
  statusFonte: string;
  parcelaNumero: number | null;
  parcelaTotal: number | null;
  /** Data da compra do parcelamento (YYYY-MM-DD), quando OF. */
  parcelaCompraEm?: string | null;
  /** Total informativo da compra (string decimal), quando parcelado. */
  parcelaCompraValor?: string | null;
  ignoradoEmRelatorio: boolean;
  possivelRepetido: boolean;
  categoriaId: string;
  categoriaNome: string;
  classificadoPor: ClassificadoPor;
  /** Trecho da regra que classificou, quando `classificadoPor = regra`. */
  regraId: string | null;
  regraTrecho: string | null;
  /** ISO — quando a origem da classificação mudou pela última vez. */
  classificadoEm: string | null;
  confiancaIa: number | null;
  tipoGasto: Perfil | null;
  papel: "gasto" | "pagamento_fatura";
  cartaoFaturaId: string | null;
  competenciaFatura: string | null;
  workspaceId?: string | null;
  /**
   * Linha só de tela: compra parcelada no dia da autorização, valor cheio.
   * Não é Fato — não soma em totais nem vai para a fatura.
   */
  apresentacao?: boolean;
  /** Valor de uma parcela, só na linha de apresentação. */
  valorParcela?: string | null;
}

class ErroApi extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly conexaoDesconectada = false,
  ) {
    super(message);
    this.name = "ErroApi";
  }
}

function mensagem_falha_rede(erro: unknown, acao: string): string {
  const texto = erro instanceof Error ? erro.message : String(erro);
  if (/failed to fetch|networkerror|load failed/i.test(texto)) {
    return (
      `${acao}: não consegui falar com a API (${URL_BASE}). ` +
      "Confira se a API está rodando (porta 3333). Em VPN/LAN, use o mesmo host do front " +
      "(ex.: http://SEU_IP:5173) e reinicie o Vite com host liberado."
    );
  }
  return texto || `Falha ao ${acao.toLowerCase()}.`;
}

async function interpretar_json<T>(resposta: Response): Promise<T> {
  if (!resposta.ok) {
    const corpo = (await resposta.json().catch(() => ({}))) as {
      erro?: string;
      message?: string;
      conexaoDesconectada?: boolean;
    };
    const mensagem =
      corpo.erro ??
      corpo.message ??
      (resposta.status === 404
        ? "Rota não encontrada na API — confira se a API foi redeployada."
        : "Erro inesperado na API.");
    throw new ErroApi(mensagem, resposta.status, Boolean(corpo.conexaoDesconectada));
  }

  if (resposta.status === 204) return undefined as T;
  return resposta.json() as Promise<T>;
}

async function requisitar<T>(caminho: string, opcoes: RequestInit = {}): Promise<T> {
  let resposta: Response;
  const headers = new Headers(opcoes.headers);
  if (opcoes.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  try {
    resposta = await fetch(`${URL_BASE}${caminho}`, {
      ...opcoes,
      headers,
    });
  } catch (erro) {
    throw new ErroApi(mensagem_falha_rede(erro, "Chamada à API"), 0);
  }
  return interpretar_json<T>(resposta);
}

async function requisitar_multipart<T>(caminho: string, corpo: FormData): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(`${URL_BASE}${caminho}`, { method: "POST", body: corpo });
  } catch (erro) {
    throw new ErroApi(mensagem_falha_rede(erro, "Chamada à API"), 0);
  }
  return interpretar_json<T>(resposta);
}

export const clienteApi = {
  /** Garante que exista um `usuario` no banco com o mesmo id do usuário autenticado no Supabase. */
  sincronizar_usuario(dados: { id: string; nome: string; email: string }): Promise<Usuario> {
    return requisitar<Usuario>("/usuarios/sincronizar", { method: "POST", body: JSON.stringify(dados) });
  },

  obter_usuario(usuarioId: string): Promise<Usuario> {
    return requisitar<Usuario>(`/usuarios/${usuarioId}`);
  },

  atualizar_usuario(
    usuarioId: string,
    dados: {
      nome?: string;
      whatsappNumero?: string | null;
      posicaoPainel?: "lateral" | "inferior";
    },
  ): Promise<Usuario> {
    return requisitar<Usuario>(`/usuarios/${usuarioId}`, {
      method: "PATCH",
      body: JSON.stringify(dados),
    });
  },

  listar_workspaces(usuarioId: string): Promise<WorkspaceResumo[]> {
    return requisitar<WorkspaceResumo[]>(`/workspaces?usuarioId=${usuarioId}`);
  },

  criar_workspace(dados: {
    usuarioId: string;
    nome: string;
    descricao?: string;
    cor?: CorWorkspace;
  }): Promise<WorkspaceResumo> {
    return requisitar<WorkspaceResumo>("/workspaces", {
      method: "POST",
      body: JSON.stringify(dados),
    });
  },

  definir_workspace_ativo(usuarioId: string, workspaceId: string): Promise<WorkspaceResumo> {
    return requisitar<WorkspaceResumo>("/workspaces/ativo", {
      method: "POST",
      body: JSON.stringify({ usuarioId, workspaceId }),
    });
  },

  atualizar_workspace(
    workspaceId: string,
    dados: {
      usuarioId: string;
      nome?: string;
      descricao?: string | null;
      cor?: CorWorkspace;
    },
  ): Promise<WorkspaceResumo> {
    return requisitar<WorkspaceResumo>(`/workspaces/${workspaceId}`, {
      method: "PATCH",
      body: JSON.stringify(dados),
    });
  },

  definir_membros_workspace(
    workspaceId: string,
    dados: { usuarioId: string; contaIds: string[]; cartaoIds: string[] },
  ): Promise<WorkspaceResumo> {
    return requisitar<WorkspaceResumo>(`/workspaces/${workspaceId}/membros`, {
      method: "POST",
      body: JSON.stringify(dados),
    });
  },

  excluir_workspace(workspaceId: string, usuarioId: string): Promise<void> {
    return requisitar<void>(`/workspaces/${workspaceId}?usuarioId=${usuarioId}`, {
      method: "DELETE",
    });
  },

  /** `todos=true`: menu Contas/Conexões (global). Default: escopo do workspace. */
  listar_contas(usuarioId: string, todos = false): Promise<ContaResumo[]> {
    const qs = todos ? `&todos=1` : "";
    return requisitar<ContaResumo[]>(`/contas?usuarioId=${usuarioId}${qs}`);
  },

  criar_conta(dados: {
    usuarioId: string;
    nome: string;
    perfil: Perfil;
    saldoInicial?: number;
  }): Promise<ContaResumo> {
    return requisitar<ContaResumo>("/contas", {
      method: "POST",
      body: JSON.stringify({
        usuarioId: dados.usuarioId,
        nome: dados.nome,
        perfil: dados.perfil,
        saldoInicial: dados.saldoInicial ?? 0,
      }),
    });
  },

  atualizar_conta(
    contaId: string,
    dados: {
      usuarioId: string;
      nome?: string;
      perfil?: Perfil;
      saldoAtual?: number;
    },
  ): Promise<ContaResumo> {
    return requisitar<ContaResumo>(`/contas/${contaId}`, {
      method: "PATCH",
      body: JSON.stringify(dados),
    });
  },

  excluir_conta(contaId: string, usuarioId: string): Promise<ContaResumo> {
    return requisitar<ContaResumo>(`/contas/${contaId}`, {
      method: "DELETE",
      body: JSON.stringify({ usuarioId }),
    });
  },

  /** `todos=true`: menu Contas/Conexões (global). Default: escopo do workspace. */
  listar_cartoes(usuarioId: string, todos = false): Promise<CartaoResumo[]> {
    const qs = todos ? `&todos=1` : "";
    return requisitar<CartaoResumo[]>(`/cartoes?usuarioId=${usuarioId}${qs}`);
  },

  criar_cartao(dados: {
    usuarioId: string;
    nome: string;
    limite: number;
    saldo?: number;
    fechamento: number;
    vencimento: number;
    perfil: Perfil;
    contaId?: string;
    plastico?: { numero: string; validade: string; cvv: string };
  }): Promise<CartaoResumo> {
    return requisitar<CartaoResumo>("/cartoes", {
      method: "POST",
      body: JSON.stringify(dados),
    });
  },

  atualizar_cartao(
    cartaoId: string,
    dados: {
      usuarioId: string;
      nome?: string;
      perfil?: Perfil;
      limite?: number;
      saldo?: number;
      fechamento?: number;
      vencimento?: number;
      contaId?: string | null;
      plastico?: { numero: string; validade: string; cvv: string };
    },
  ): Promise<CartaoResumo> {
    return requisitar<CartaoResumo>(`/cartoes/${cartaoId}`, {
      method: "PATCH",
      body: JSON.stringify(dados),
    });
  },

  excluir_cartao(cartaoId: string, usuarioId: string): Promise<CartaoResumo> {
    return requisitar<CartaoResumo>(`/cartoes/${cartaoId}`, {
      method: "DELETE",
      body: JSON.stringify({ usuarioId }),
    });
  },

  revelar_plastico(
    cartaoId: string,
    dados: { usuarioId: string; senha: string },
  ): Promise<{ numero: string; validade: string; cvv: string }> {
    return requisitar<{ numero: string; validade: string; cvv: string }>(
      `/cartoes/${cartaoId}/revelar`,
      {
        method: "POST",
        body: JSON.stringify(dados),
      },
    );
  },

  listar_categorias(usuarioId: string, mes?: string): Promise<CategoriaResumo[]> {
    const params = new URLSearchParams({ usuarioId });
    if (mes) params.set("mes", mes);
    return requisitar<CategoriaResumo[]>(`/categorias?${params}`);
  },

  criar_categoria(dados: {
    usuarioId: string;
    nome: string;
    tipo: TipoCategoria;
    icone?: string;
    cor?: string;
    limite?: number | null;
  }): Promise<CategoriaResumo> {
    return requisitar<CategoriaResumo>("/categorias", {
      method: "POST",
      body: JSON.stringify(dados),
    });
  },

  atualizar_categoria(
    categoriaId: string,
    dados: {
      usuarioId: string;
      nome?: string;
      tipo?: TipoCategoria;
      icone?: string;
      cor?: string;
      limite?: number | null;
    },
  ): Promise<CategoriaResumo> {
    return requisitar<CategoriaResumo>(`/categorias/${categoriaId}`, {
      method: "PATCH",
      body: JSON.stringify(dados),
    });
  },

  listar_regras(usuarioId: string): Promise<RegraResumo[]> {
    return requisitar<RegraResumo[]>(`/regras?usuarioId=${usuarioId}`);
  },

  criar_regra(dados: {
    usuarioId: string;
    nome: string;
    logicaCondicoes?: LogicaCondicoesRegra;
    condicoes: CondicaoRegraApi[];
    acoes: AcaoRegraApi[];
    ativa?: boolean;
    aplicarExistentes?: boolean;
  }): Promise<RegraResumo> {
    return requisitar<RegraResumo>("/regras", {
      method: "POST",
      body: JSON.stringify(dados),
    });
  },

  atualizar_regra(
    regraId: string,
    dados: {
      usuarioId: string;
      nome?: string;
      logicaCondicoes?: LogicaCondicoesRegra;
      condicoes?: CondicaoRegraApi[];
      acoes?: AcaoRegraApi[];
      ativa?: boolean;
      aplicarExistentes?: boolean;
    },
  ): Promise<RegraResumo> {
    return requisitar<RegraResumo>(`/regras/${regraId}`, {
      method: "PATCH",
      body: JSON.stringify(dados),
    });
  },

  definir_ativa_regra(dados: {
    regraId: string;
    usuarioId: string;
    ativa: boolean;
  }): Promise<RegraResumo> {
    return requisitar<RegraResumo>(`/regras/${dados.regraId}`, {
      method: "PATCH",
      body: JSON.stringify({ usuarioId: dados.usuarioId, ativa: dados.ativa }),
    });
  },

  excluir_regra(regraId: string, usuarioId: string): Promise<void> {
    return requisitar<void>(`/regras/${regraId}?usuarioId=${usuarioId}`, {
      method: "DELETE",
    });
  },

  listar_pessoas(usuarioId: string): Promise<PessoaResumo[]> {
    return requisitar<PessoaResumo[]>(`/pessoas?usuarioId=${usuarioId}`);
  },

  listar_movimentos(usuarioId: string): Promise<MovimentoResumo[]> {
    return requisitar<MovimentoResumo[]>(`/movimentos?usuarioId=${usuarioId}`);
  },

  excluir_movimento(movimentoId: string, usuarioId: string): Promise<{ ok: boolean }> {
    return requisitar<{ ok: boolean }>(
      `/movimentos/${movimentoId}?usuarioId=${encodeURIComponent(usuarioId)}`,
      { method: "DELETE" },
    );
  },

  listar_parcelas_irmas(
    movimentoId: string,
    usuarioId: string,
  ): Promise<{
    ancoraId: string;
    totalCompra: number | null;
    parcelas: Array<{
      id: string;
      descricao: string;
      valor: string;
      status: MovimentoResumo["status"];
      dataMovimento: string;
      parcelaNumero: number | null;
      parcelaTotal: number | null;
    }>;
  }> {
    return requisitar(
      `/movimentos/${movimentoId}/parcelas-irmas?usuarioId=${encodeURIComponent(usuarioId)}`,
    );
  },

  /** Escrita explícita de Conhecimento — nunca envia Fato. */
  atualizar_conhecimento(dados: {
    usuarioId: string;
    movimentoId: string;
    categoriaId?: string;
    tipoGasto?: Perfil;
    ignoradoEmRelatorio?: boolean;
    possivelRepetido?: boolean;
    papel?: "gasto" | "pagamento_fatura";
    cartaoFaturaId?: string | null;
    competenciaFatura?: string | null;
  }): Promise<{
    id: string;
    descricao: string;
    categoriaId: string;
    categoriaNome: string;
    classificadoPor: ClassificadoPor;
    regraId: string | null;
    classificadoEm: string | null;
    confiancaIa: number | null;
    tipoGasto: Perfil | null;
    ignoradoEmRelatorio: boolean;
    possivelRepetido: boolean;
    papel: "gasto" | "pagamento_fatura";
    cartaoFaturaId: string | null;
    competenciaFatura: string | null;
    propostaRegra: { trecho: string; categoriaNome: string } | null;
    parcelasAtualizadas?: number;
    iguaisAtualizados?: number;
  }> {
    return requisitar("/conhecimento", {
      method: "PATCH",
      body: JSON.stringify(dados),
    });
  },

  criar_regra_de_correcao(dados: { usuarioId: string; movimentoId: string }): Promise<{
    criada: boolean;
    motivo: string | null;
    proposta: { trecho: string; categoriaNome: string } | null;
  }> {
    return requisitar("/conhecimento/virar-regra", {
      method: "POST",
      body: JSON.stringify(dados),
    });
  },

  obter_dashboard(
    usuarioId: string,
    data?: string,
    tipoGasto?: "pf" | "pj",
  ): Promise<DashboardResposta> {
    const query = new URLSearchParams({ usuarioId });
    if (data) query.set("data", data);
    if (tipoGasto) query.set("tipoGasto", tipoGasto);
    return requisitar<DashboardResposta>(`/dashboard?${query.toString()}`);
  },

  listar_recorrencias(usuarioId: string): Promise<
    Array<{
      id: string;
      descricao: string;
      valor: number;
      tipo: string;
      diaDoMes: number;
      categoriaId: string;
      categoriaNome: string | null;
      icone: string;
      cor: string;
      contaNome: string | null;
      cartaoNome: string | null;
    }>
  > {
    return requisitar(`/recorrencias?usuarioId=${encodeURIComponent(usuarioId)}`);
  },

  listar_parcelamentos(
    usuarioId: string,
    data?: string,
    tipoGasto?: "pf" | "pj",
  ): Promise<{
    meses: Array<{ mes: string; parcelas: number; recorrentes: number }>;
    compras: Array<{
      descricao: string;
      cartaoNome: string;
      tipoGasto?: string | null;
      valorTotal: number;
      valorParcela: number;
      parcelasTotais: number;
      parcelasPagas: number;
      parcelasRestantes: number;
      valorRestante: number;
      proximaParcelaData: string | null;
      parcelasPorMes: Array<{ mes: string; valor: number }>;
    }>;
    recorrentes: Array<{
      id: string;
      descricao: string;
      valor: number;
      origem: "cadastro" | "detectado";
      diaDoMes: number | null;
      categoriaNome: string | null;
      icone: string;
      cor: string;
      contaNome: string | null;
      cartaoNome: string | null;
      tipo: string;
      tipoGasto: "pf" | "pj";
    }>;
  }> {
    const query = new URLSearchParams({ usuarioId });
    if (data) query.set("data", data);
    if (tipoGasto) query.set("tipoGasto", tipoGasto);
    return requisitar(`/recorrencias/parcelamentos?${query.toString()}`, { cache: "no-store" });
  },

  enviar_mensagem_chat(dados: { usuarioId: string; mensagem: string; sessaoId?: string }): Promise<RespostaChat> {
    return requisitar<RespostaChat>("/chat", { method: "POST", body: JSON.stringify(dados) });
  },

  consultar_pipeline_chat(): Promise<{ pipeline: PipelineAssistente }> {
    return requisitar<{ pipeline: PipelineAssistente }>("/chat/pipeline");
  },

  buscar_historico_chat(sessaoId: string): Promise<MensagemChat[]> {
    return requisitar<MensagemChat[]>(`/chat/${sessaoId}/mensagens`);
  },

  descrever_fonte(): Promise<DescritorFonte> {
    return requisitar<DescritorFonte>("/open-finance/fonte");
  },

  /** Token de curta duração que abre o widget. Com `conexaoId`, é reconexão. */
  criar_token_conexao(dados: { usuarioId: string; conexaoId?: string }): Promise<TokenConexao> {
    return requisitar<TokenConexao>("/open-finance/conexoes/token", {
      method: "POST",
      body: JSON.stringify(dados),
    });
  },

  registrar_conexao(dados: { usuarioId: string; conexaoExterna: string }): Promise<ConexaoComContas> {
    return requisitar<ConexaoComContas>("/open-finance/conexoes", {
      method: "POST",
      body: JSON.stringify(dados),
    });
  },

  inspecionar_item(dados: {
    usuarioId: string;
    conexaoExterna: string;
    conexaoId?: string;
  }): Promise<InspecaoItemOf> {
    return requisitar<InspecaoItemOf>("/open-finance/conexoes/inspecionar", {
      method: "POST",
      body: JSON.stringify(dados),
    });
  },

  /**
   * Reconecta a conexão existente (novo ou mesmo itemId) e sincroniza só o novo.
   * Consome NDJSON (mesmo padrão de atualizar_conexao).
   */
  async reatachar_conexao(
    dados: {
      usuarioId: string;
      conexaoExterna: string;
      pareamentos?: PareamentoReatachar[];
      conexaoId?: string;
      conexaoIdAnterior?: string;
      alvoContaId?: string;
      alvoCartaoId?: string;
    },
    aoProgresso?: (progresso: ProgressoImportacaoApi) => void,
  ): Promise<{ detalhe: ConexaoComContas; resumo: ResumoReatachar }> {
    let resposta: Response;
    try {
      resposta = await fetch(`${URL_BASE}/open-finance/conexoes/reatachar`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
        },
        body: JSON.stringify(dados),
      });
    } catch (erro) {
      throw new ErroApi(mensagem_falha_rede(erro, "Reconectar banco"), 0);
    }

    if (!resposta.ok) {
      const corpo = (await resposta.json().catch(() => ({}))) as {
        erro?: string;
        message?: string;
      };
      throw new ErroApi(
        corpo.erro ?? corpo.message ?? "Não foi possível reconectar o banco.",
        resposta.status,
      );
    }

    if (!resposta.body) {
      throw new ErroApi("Resposta sem corpo ao reconectar.", 502);
    }

    let fim: { detalhe: ConexaoComContas; resumo: ResumoReatachar } | null = null;
    await ler_stream_ndjson(resposta.body, (evento) => {
      if (evento.tipo === "progresso") {
        aoProgresso?.({
          percentual: evento.percentual,
          mensagem: evento.mensagem,
          criados: evento.criados,
          duplicados: evento.duplicados,
          contaAtual: evento.contaAtual,
          contasTotal: evento.contasTotal,
        });
      } else if (evento.tipo === "fim") {
        fim = { detalhe: evento.detalhe, resumo: evento.resumo };
      } else if (evento.tipo === "erro") {
        throw new ErroApi(evento.erro, 502, Boolean(evento.conexaoDesconectada));
      }
    });

    if (!fim) {
      throw new ErroApi("Importação terminou sem resultado.", 502);
    }
    return fim;
  },

  listar_conexoes(usuarioId: string): Promise<ConexaoDetalhada[]> {
    return requisitar<ConexaoDetalhada[]>(`/open-finance/conexoes?usuarioId=${usuarioId}`);
  },

  detalhar_conexao(conexaoId: string, usuarioId: string): Promise<ConexaoComContas> {
    return requisitar<ConexaoComContas>(
      `/open-finance/conexoes/${conexaoId}?usuarioId=${usuarioId}`,
    );
  },

  /**
   * Atualiza saldos e importa extrato. Consome NDJSON com progresso
   * (`aoProgresso`) e devolve o detalhe final da conexão.
   */
  async atualizar_conexao(
    conexaoId: string,
    usuarioId: string,
    aoProgresso?: (progresso: ProgressoImportacaoApi) => void,
  ): Promise<ConexaoComContas> {
    let resposta: Response;
    try {
      resposta = await fetch(`${URL_BASE}/open-finance/conexoes/${conexaoId}/atualizar`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
        },
        body: JSON.stringify({ usuarioId }),
      });
    } catch (erro) {
      throw new ErroApi(mensagem_falha_rede(erro, "Atualizar conexão"), 0);
    }

    if (!resposta.ok) {
      const corpo = (await resposta.json().catch(() => ({}))) as {
        erro?: string;
        message?: string;
      };
      throw new ErroApi(
        corpo.erro ?? corpo.message ?? "Não foi possível atualizar a conexão.",
        resposta.status,
      );
    }

    if (!resposta.body) {
      throw new ErroApi("Resposta sem corpo na importação.", 502);
    }

    let detalhe: ConexaoComContas | null = null;
    await ler_stream_ndjson(resposta.body, (evento) => {
      if (evento.tipo === "progresso") {
        aoProgresso?.({
          percentual: evento.percentual,
          mensagem: evento.mensagem,
          criados: evento.criados,
          duplicados: evento.duplicados,
          contaAtual: evento.contaAtual,
          contasTotal: evento.contasTotal,
        });
      } else if (evento.tipo === "fim") {
        detalhe = evento.detalhe;
        aoProgresso?.({
          percentual: 100,
          mensagem: "Importação concluída.",
          criados: evento.resumo.criados,
          duplicados: evento.resumo.duplicados,
          contaAtual: evento.resumo.criados > 0 ? 1 : 0,
          contasTotal: 0,
        });
      } else if (evento.tipo === "erro") {
        throw new ErroApi(evento.erro, 502);
      }
    });

    if (!detalhe) {
      throw new ErroApi("Importação terminou sem resultado.", 502);
    }
    return detalhe;
  },

  desconectar_conexao(conexaoId: string, usuarioId: string): Promise<ConexaoComContas> {
    return requisitar<ConexaoComContas>(`/open-finance/conexoes/${conexaoId}/desconectar`, {
      method: "POST",
      body: JSON.stringify({ usuarioId }),
    });
  },

  /** Fecha a conta local para lançamento manual. A tela avisa antes de chamar. */
  associar_conta_externa(dados: {
    conexaoId: string;
    contaExternaId: string;
    usuarioId: string;
    contaId?: string;
    cartaoId?: string;
  }): Promise<ConexaoComContas> {
    const { conexaoId, contaExternaId, ...corpo } = dados;
    return requisitar<ConexaoComContas>(
      `/open-finance/conexoes/${conexaoId}/contas/${encodeURIComponent(contaExternaId)}`,
      { method: "PUT", body: JSON.stringify(corpo) },
    );
  },

  desassociar_conta_externa(dados: {
    conexaoId: string;
    contaExternaId: string;
    usuarioId: string;
  }): Promise<ConexaoComContas> {
    const { conexaoId, contaExternaId, usuarioId } = dados;
    return requisitar<ConexaoComContas>(
      `/open-finance/conexoes/${conexaoId}/contas/${encodeURIComponent(contaExternaId)}`,
      { method: "DELETE", body: JSON.stringify({ usuarioId }) },
    );
  },

  /** Só com `OPEN_FINANCE_PROVEDOR=duble`: conexão sem widget. */
  criar_conexao_duble(usuarioId: string): Promise<ConexaoComContas> {
    return requisitar<ConexaoComContas>("/open-finance/duble/conexoes", {
      method: "POST",
      body: JSON.stringify({ usuarioId }),
    });
  },

  /** Seméia lote de mentira e roda ingestão + classificação. */
  sincronizar_duble(
    conexaoId: string,
    usuarioId: string,
  ): Promise<ResumoIngestaoUi & { eventoId: string; movimentoIdsCriados?: string[] }> {
    return requisitar(`/open-finance/duble/conexoes/${conexaoId}/sincronizar`, {
      method: "POST",
      body: JSON.stringify({ usuarioId }),
    });
  },

  preview_importacao_pdf(dados: {
    usuarioId: string;
    arquivo: File;
    contaId?: string;
    cartaoId?: string;
  }): Promise<PreviewImportacaoPdf> {
    const corpo = new FormData();
    corpo.append("usuarioId", dados.usuarioId);
    corpo.append("arquivo", dados.arquivo);
    if (dados.contaId) corpo.append("contaId", dados.contaId);
    if (dados.cartaoId) corpo.append("cartaoId", dados.cartaoId);
    return requisitar_multipart<PreviewImportacaoPdf>("/importacoes/pdf", corpo);
  },

  confirmar_importacao_pdf(dados: {
    usuarioId: string;
    arquivoHash: string;
    provedor: string;
    linhas: Array<
      Omit<LinhaPreviewPdf, "destino" | "aceita"> & { destino: DestinoPdf }
    >;
  }): Promise<ResultadoConfirmarPdf> {
    return requisitar<ResultadoConfirmarPdf>("/importacoes/pdf/confirmar", {
      method: "POST",
      body: JSON.stringify(dados),
    });
  },
};

export { ErroApi };
