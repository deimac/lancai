import type { IntencaoDetectada, Perfil } from "@lancai/tipos";

const URL_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3333";

export type OrigemFinanceira = "manual" | "open_finance";

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
  workspaceId?: string;
  workspaceNome?: string | null;
  contaId?: string | null;
  /** True quando há blob de plástico salvo (sem revelar dados). */
  temPlastico?: boolean;
  /** Últimos 4 dígitos derivados na leitura (decifragem do blob); não é coluna. */
  final4?: string | null;
}

export type TipoCategoria = "receita" | "despesa" | "ambos";

export interface CategoriaResumo {
  id: string;
  nome: string;
  tipo: TipoCategoria;
  ativo?: boolean;
}

export type OrigemRegra = "manual" | "aprendizado_conversa";

export interface RegraResumo {
  id: string;
  origem: OrigemRegra;
  ativa: boolean;
  condicaoTipo: "descricao_contem";
  condicaoValor: string;
  categoriaId: string;
  categoriaNome: string;
  perfil: Perfil | null;
  dataCriacao: string;
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
  intencao: IntencaoDetectada;
  resposta: string;
}

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
}

export type StatusConexao = "ativa" | "sincronizando" | "precisa_atencao" | "removida";

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

export interface ConexaoDetalhada {
  id: string;
  idExterno: string;
  status: StatusConexao;
  instituicao: string | null;
  motivoAtencao: MotivoAtencao | null;
  ultimoSyncEm: string | null;
  consentimentoExpiraEm: string | null;
  ultimoResumoIngestao: ResumoIngestaoUi | null;
}

export interface ContaExternaRegistrada {
  contaExternaId: string;
  nome: string;
  tipo: string;
  contaId: string | null;
  cartaoId: string | null;
}

export interface ConexaoComContas {
  conexao: ConexaoDetalhada;
  contas: ContaExternaRegistrada[];
}

export interface DashboardResposta {
  mes: string;
  periodo: { de: string; ate: string };
  resumo: {
    saldoTotal: number;
    receitasMes: number;
    despesasMes: number;
    saldoPeriodo: number;
    taxaEconomia: number | null;
  };
  naoClassificado: { quantidade: number; total: number };
  gastosPorCategoria: Array<{ categoriaNome: string; total: number }>;
  fluxoSaldo: Array<{ data: string; saldo: number }>;
  recentes: Array<{
    id: string;
    data: string;
    descricao: string;
    valor: number;
    tipo: string;
    categoriaNome: string | null;
    origemNome: string | null;
  }>;
  contas: Array<{ nome: string; perfil: string; saldoAtual: number }>;
  cartoes: Array<{
    nome: string;
    perfil: string;
    limite: number;
    comprometido: number;
    disponivel: number;
  }>;
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
  dataMovimento: string;
  contaId: string | null;
  cartaoId: string | null;
  statusFonte: string;
  parcelaNumero: number | null;
  parcelaTotal: number | null;
  ignoradoEmRelatorio: boolean;
  categoriaId: string;
  categoriaNome: string;
  classificadoPor: ClassificadoPor;
  /** Trecho da regra que classificou, quando `classificadoPor = regra`. */
  regraId: string | null;
  regraTrecho: string | null;
  /** ISO — quando a origem da classificação mudou pela última vez. */
  classificadoEm: string | null;
  confiancaIa: number | null;
  perfil: Perfil | null;
}

class ErroApi extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ErroApi";
  }
}

async function requisitar<T>(caminho: string, opcoes: RequestInit = {}): Promise<T> {
  const resposta = await fetch(`${URL_BASE}${caminho}`, {
    ...opcoes,
    headers: { "Content-Type": "application/json", ...opcoes.headers },
  });

  if (!resposta.ok) {
    const corpo = (await resposta.json().catch(() => ({}))) as {
      erro?: string;
      message?: string;
    };
    const mensagem =
      corpo.erro ??
      corpo.message ??
      (resposta.status === 404
        ? "Rota não encontrada na API — confira se a API foi redeployada."
        : "Erro inesperado na API.");
    throw new ErroApi(mensagem, resposta.status);
  }

  if (resposta.status === 204) return undefined as T;
  return resposta.json() as Promise<T>;
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

  listar_categorias(usuarioId: string): Promise<CategoriaResumo[]> {
    return requisitar<CategoriaResumo[]>(`/categorias?usuarioId=${usuarioId}`);
  },

  criar_categoria(dados: {
    usuarioId: string;
    nome: string;
    tipo: TipoCategoria;
  }): Promise<CategoriaResumo> {
    return requisitar<CategoriaResumo>("/categorias", {
      method: "POST",
      body: JSON.stringify(dados),
    });
  },

  listar_regras(usuarioId: string): Promise<RegraResumo[]> {
    return requisitar<RegraResumo[]>(`/regras?usuarioId=${usuarioId}`);
  },

  criar_regra(dados: {
    usuarioId: string;
    condicaoValor: string;
    categoriaId: string;
    perfil?: Perfil;
  }): Promise<RegraResumo> {
    return requisitar<RegraResumo>("/regras", {
      method: "POST",
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

  listar_movimentos(usuarioId: string): Promise<MovimentoResumo[]> {
    return requisitar<MovimentoResumo[]>(`/movimentos?usuarioId=${usuarioId}`);
  },

  /** Escrita explícita de Conhecimento — nunca envia Fato. */
  atualizar_conhecimento(dados: {
    usuarioId: string;
    movimentoId: string;
    categoriaId?: string;
    perfil?: Perfil;
    ignoradoEmRelatorio?: boolean;
  }): Promise<{
    id: string;
    descricao: string;
    categoriaId: string;
    categoriaNome: string;
    classificadoPor: ClassificadoPor;
    regraId: string | null;
    classificadoEm: string | null;
    confiancaIa: number | null;
    perfil: Perfil | null;
    ignoradoEmRelatorio: boolean;
  }> {
    return requisitar("/conhecimento", {
      method: "PATCH",
      body: JSON.stringify(dados),
    });
  },

  obter_dashboard(usuarioId: string, data?: string): Promise<DashboardResposta> {
    const query = new URLSearchParams({ usuarioId });
    if (data) query.set("data", data);
    return requisitar<DashboardResposta>(`/dashboard?${query.toString()}`);
  },

  enviar_mensagem_chat(dados: { usuarioId: string; mensagem: string; sessaoId?: string }): Promise<RespostaChat> {
    return requisitar<RespostaChat>("/chat", { method: "POST", body: JSON.stringify(dados) });
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

  listar_conexoes(usuarioId: string): Promise<ConexaoDetalhada[]> {
    return requisitar<ConexaoDetalhada[]>(`/open-finance/conexoes?usuarioId=${usuarioId}`);
  },

  detalhar_conexao(conexaoId: string, usuarioId: string): Promise<ConexaoComContas> {
    return requisitar<ConexaoComContas>(
      `/open-finance/conexoes/${conexaoId}?usuarioId=${usuarioId}`,
    );
  },

  /** Pede sync pontual ao provedor; o extrato chega depois no webhook. */
  atualizar_conexao(conexaoId: string, usuarioId: string): Promise<ConexaoComContas> {
    return requisitar<ConexaoComContas>(`/open-finance/conexoes/${conexaoId}/atualizar`, {
      method: "POST",
      body: JSON.stringify({ usuarioId }),
    });
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
};

export { ErroApi };
