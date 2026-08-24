import type { ContextoInterpretacao } from "./prompt";

const STOPWORDS = new Set([
  "de",
  "da",
  "do",
  "das",
  "dos",
  "o",
  "a",
  "e",
  "com",
  "no",
  "na",
  "nos",
  "nas",
  "em",
  "um",
  "uma",
  "meu",
  "minha",
  "cartao",
  "conta",
  "banco",
  "gastei",
  "paguei",
  "comprei",
  "recebi",
  "ontem",
  "hoje",
  "farmacia",
  "mercado",
]);

export function normalizar_texto_busca(texto: string): string {
  return texto
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ç/g, "c");
}

function tokens_significativos(nome: string): string[] {
  return normalizar_texto_busca(nome)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

function escapar_regex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Tira o sufixo "do cartão Revolut Visa" / "da conta C6" do termo de busca,
 * para a descrição do lançamento não virar o nome do plástico.
 */
export function cortar_cadastro_do_texto(texto: string, nomeCadastro: string): string {
  const tokens = tokens_significativos(nomeCadastro);
  if (tokens.length === 0) return texto.trim();
  const corpo = tokens.map(escapar_regex).join("\\s+");
  const re = new RegExp(
    String.raw`(?:\s+(?:do|da|de|dos|das|no|na|nos|nas|com))?(?:\s+(?:cart[aã]o|conta))?\s+${corpo}\s*$`,
    "i",
  );
  return texto.replace(re, "").trim();
}

function pontuar_nome_na_mensagem(mensagemNorm: string, nome: string): number {
  const nomeNorm = normalizar_texto_busca(nome);
  if (mensagemNorm.includes(nomeNorm)) return 100 + nomeNorm.length;

  let score = 0;
  for (const token of tokens_significativos(nome)) {
    // Evita falso positivo: "banco" em tudo; exige token isolado ou substring clara.
    const isolado = new RegExp(`(?:^|[^a-z0-9])${token}(?:$|[^a-z0-9])`);
    if (isolado.test(mensagemNorm)) score += token.length;
  }
  return score;
}

export function nome_corresponde_cadastro(cadastro: string, citado: string): boolean {
  const a = normalizar_texto_busca(cadastro);
  const b = normalizar_texto_busca(citado);
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const tokensCitados = tokens_significativos(citado);
  if (tokensCitados.length === 0) return false;
  const tokensCadastro = new Set(tokens_significativos(cadastro));
  return tokensCitados.every((token) => tokensCadastro.has(token) || a.includes(token));
}

/** Resolve apelido ("azul", "c6") para o nome canônico cadastrado. */
export function resolver_nome_canonico(
  citado: string | null | undefined,
  cadastros: Array<{ nome: string }>,
): string | null {
  if (!citado?.trim()) return null;
  const exato = cadastros.find((item) => nome_corresponde_cadastro(item.nome, citado));
  if (exato) return exato.nome;

  const mensagemNorm = normalizar_texto_busca(citado);
  let melhor: { nome: string; score: number } | null = null;
  for (const item of cadastros) {
    const score = pontuar_nome_na_mensagem(mensagemNorm, item.nome);
    if (score > 0 && (!melhor || score > melhor.score)) {
      melhor = { nome: item.nome, score };
    }
  }
  return melhor?.nome ?? citado.trim();
}

/**
 * Extrai conta/cartão da mensagem batendo contra o contexto.
 * Ex.: "com o cartao azul" + cartão "Azul Itaú" → cartao_nome = "Azul Itaú".
 */
export function inferir_origem_da_mensagem(
  mensagem: string,
  contexto: ContextoInterpretacao,
): { conta_nome?: string; cartao_nome?: string } {
  const msg = normalizar_texto_busca(mensagem);
  const mencionaCartao = /\bcartao\b/.test(msg);
  const mencionaConta = /\bconta\b/.test(msg);

  let melhorCartao: { nome: string; score: number } | null = null;
  for (const cartao of contexto.cartoes) {
    const score = pontuar_nome_na_mensagem(msg, cartao.nome);
    if (score > 0 && (!melhorCartao || score > melhorCartao.score)) {
      melhorCartao = { nome: cartao.nome, score };
    }
  }

  let melhorConta: { nome: string; score: number } | null = null;
  for (const conta of contexto.contas) {
    const score = pontuar_nome_na_mensagem(msg, conta.nome);
    if (score > 0 && (!melhorConta || score > melhorConta.score)) {
      melhorConta = { nome: conta.nome, score };
    }
  }

  if (mencionaCartao) {
    if (melhorCartao) return { cartao_nome: melhorCartao.nome };
    if (contexto.cartoes.length === 1) return { cartao_nome: contexto.cartoes[0]!.nome };
  }

  if (mencionaConta && melhorConta) {
    return { conta_nome: melhorConta.nome };
  }

  // Sem palavra "cartão"/"conta": usa o melhor score (mín. 2 — cobre apelidos como "C6").
  if (melhorCartao && melhorCartao.score >= 2 && (!melhorConta || melhorCartao.score >= melhorConta.score)) {
    return { cartao_nome: melhorCartao.nome };
  }
  if (melhorConta && melhorConta.score >= 2) {
    return { conta_nome: melhorConta.nome };
  }

  return {};
}
