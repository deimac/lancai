import type { IntencaoDetectada, Perfil } from "@lancai/tipos";

const URL_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3333";

export interface ContaResumo {
  id: string;
  nome: string;
  saldoAtual: string;
  perfil: Perfil;
}

export interface CartaoResumo {
  id: string;
  nome: string;
  limite: string;
  perfil: Perfil;
  modalidade: "credito" | "debito" | "multiplo";
  vencimento: number;
  /** Últimos 4 dígitos quando o plástico foi cadastrado. */
  final4?: string | null;
}

export interface Usuario {
  id: string;
  nome: string;
  email: string;
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
    const corpo = await resposta.json().catch(() => ({ erro: resposta.statusText }));
    throw new ErroApi(corpo.erro ?? "Erro inesperado na API.", resposta.status);
  }

  if (resposta.status === 204) return undefined as T;
  return resposta.json() as Promise<T>;
}

export const clienteApi = {
  /** Garante que exista um `usuario` no banco com o mesmo id do usuário autenticado no Supabase. */
  sincronizar_usuario(dados: { id: string; nome: string; email: string }): Promise<Usuario> {
    return requisitar<Usuario>("/usuarios/sincronizar", { method: "POST", body: JSON.stringify(dados) });
  },

  listar_contas(usuarioId: string): Promise<ContaResumo[]> {
    return requisitar<ContaResumo[]>(`/contas?usuarioId=${usuarioId}`);
  },

  listar_cartoes(usuarioId: string): Promise<CartaoResumo[]> {
    return requisitar<CartaoResumo[]>(`/cartoes?usuarioId=${usuarioId}`);
  },

  enviar_mensagem_chat(dados: { usuarioId: string; mensagem: string; sessaoId?: string }): Promise<RespostaChat> {
    return requisitar<RespostaChat>("/chat", { method: "POST", body: JSON.stringify(dados) });
  },

  buscar_historico_chat(sessaoId: string): Promise<MensagemChat[]> {
    return requisitar<MensagemChat[]>(`/chat/${sessaoId}/mensagens`);
  },
};

export { ErroApi };
