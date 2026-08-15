import { ErroConexaoExternaInexistente, ErroProvedorIndisponivel } from "../erros";

export const BASE_PLUGGY = "https://api.pluggy.ai";

/**
 * A API Key vale 2 horas. Renovamos aos 100 minutos para nunca esbarrar na
 * borda: uma chave que expira no meio de uma paginação de 365 dias de histórico
 * transformaria um lote inteiro em erro.
 */
const VALIDADE_CHAVE_MS = 100 * 60 * 1000;

export interface ConfigPluggy {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  /** Injetável para teste. Sem isto, testar o adaptador exigiria rede. */
  buscar?: typeof fetch;
  agora?: () => number;
}

/**
 * O transporte HTTP da Pluggy, separado do adaptador de propósito: aqui mora
 * autenticação e formato de erro, ali mora tradução de vocabulário. Misturar os
 * dois faria cada teste de mapeamento carregar um mock de login junto.
 */
export class ClientePluggy {
  private readonly baseUrl: string;
  private readonly buscar: typeof fetch;
  private readonly agora: () => number;

  private chave: string | null = null;
  private chaveExpiraEm = 0;
  /** Evita que dez requisições concorrentes disparem dez logins. */
  private autenticacaoEmCurso: Promise<string> | null = null;

  constructor(private readonly config: ConfigPluggy) {
    this.baseUrl = config.baseUrl ?? BASE_PLUGGY;
    this.buscar = config.buscar ?? fetch;
    this.agora = config.agora ?? Date.now;
  }

  private async obter_chave(): Promise<string> {
    if (this.chave && this.agora() < this.chaveExpiraEm) return this.chave;
    if (this.autenticacaoEmCurso) return this.autenticacaoEmCurso;

    this.autenticacaoEmCurso = this.autenticar().finally(() => {
      this.autenticacaoEmCurso = null;
    });
    return this.autenticacaoEmCurso;
  }

  private async autenticar(): Promise<string> {
    const resposta = await this.buscar(`${this.baseUrl}/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
      }),
    });

    if (!resposta.ok) {
      throw new ErroProvedorIndisponivel(
        `autenticação recusada pelo provedor (HTTP ${resposta.status})`,
      );
    }

    const corpo = (await resposta.json()) as { apiKey?: string };
    if (!corpo.apiKey) {
      throw new ErroProvedorIndisponivel("autenticação sem apiKey na resposta");
    }

    this.chave = corpo.apiKey;
    this.chaveExpiraEm = this.agora() + VALIDADE_CHAVE_MS;
    return corpo.apiKey;
  }

  /**
   * `caminho` pode ser relativo (`/accounts?itemId=x`) ou absoluto, porque a
   * Pluggy manda no webhook um link pronto e o cursor de paginação vem como
   * query string solta. Reconstruir a URL a partir das partes daria chance de
   * perder um parâmetro que o provedor considera essencial.
   */
  async obter<T>(caminho: string): Promise<T> {
    return this.requisitar<T>(caminho, { method: "GET" });
  }

  async postar<T>(caminho: string, corpo: unknown): Promise<T> {
    return this.requisitar<T>(caminho, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
  }

  async remendar<T>(caminho: string, corpo: unknown = {}): Promise<T> {
    return this.requisitar<T>(caminho, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
  }

  private async requisitar<T>(caminho: string, opcoes: RequestInit): Promise<T> {
    const url = caminho.startsWith("http") ? caminho : `${this.baseUrl}${caminho}`;

    const enviar = async (chave: string) =>
      this.buscar(url, {
        ...opcoes,
        headers: { ...opcoes.headers, "X-API-KEY": chave },
      });

    let resposta = await enviar(await this.obter_chave());

    /**
     * Chave revogada ou expirada antes da hora: autentica de novo e repete uma
     * vez só. Repetir em laço transformaria credencial errada em tempestade de
     * requisições contra o provedor.
     */
    if (resposta.status === 401 || resposta.status === 403) {
      this.chave = null;
      resposta = await enviar(await this.obter_chave());
    }

    if (!resposta.ok) {
      const detalhe = await ler_detalhe_erro(resposta);
      throw erro_http_do_provedor(
        opcoes.method ?? "GET",
        caminho,
        resposta.status,
        detalhe,
      );
    }

    if (resposta.status === 204) return undefined as T;
    const texto = await resposta.text();
    if (!texto.trim()) return undefined as T;
    return JSON.parse(texto) as T;
  }
}

/**
 * 404 no item (e 400 “not found” no GET /items) = o item foi apagado no
 * provedor. 404 em transação isolada (ou 5xx/429) continua indisponibilidade:
 * retry, não `removida`.
 */
function erro_http_do_provedor(
  metodo: string,
  caminho: string,
  status: number,
  detalhe: string,
): ErroConexaoExternaInexistente | ErroProvedorIndisponivel {
  const mensagem = `${metodo} ${caminho} devolveu HTTP ${status}${detalhe}`;
  if (item_nao_encontrado(status, caminho, detalhe)) {
    return new ErroConexaoExternaInexistente(mensagem);
  }
  return new ErroProvedorIndisponivel(mensagem);
}

function item_nao_encontrado(status: number, caminho: string, detalhe: string): boolean {
  if (status === 404 && caminho_eh_item_ou_contas(caminho)) return true;
  if (
    status === 400 &&
    caminho_eh_item(caminho) &&
    /not found|does not exist|ITEM_NOT_FOUND/i.test(detalhe)
  ) {
    return true;
  }
  return false;
}

function caminho_eh_item(caminho: string): boolean {
  const relativo = caminho_relativo(caminho);
  const semQuery = relativo.split("?")[0] ?? relativo;
  return /\/items\/[^/]+/.test(semQuery);
}

function caminho_eh_item_ou_contas(caminho: string): boolean {
  const relativo = caminho_relativo(caminho);
  const semQuery = relativo.split("?")[0] ?? relativo;
  if (/\/items\/[^/]+/.test(semQuery)) return true;
  if (semQuery === "/accounts" || semQuery.endsWith("/accounts")) return true;
  return false;
}

function caminho_relativo(caminho: string): string {
  if (!caminho.startsWith("http")) return caminho;
  try {
    const url = new URL(caminho);
    return `${url.pathname}${url.search}`;
  } catch {
    return caminho;
  }
}

async function ler_detalhe_erro(resposta: Response): Promise<string> {
  try {
    const corpo = (await resposta.json()) as { message?: string; code?: string };
    if (corpo.code || corpo.message) {
      return ` (${[corpo.code, corpo.message].filter(Boolean).join(": ")})`;
    }
  } catch {
    /* corpo não é JSON */
  }
  return "";
}
