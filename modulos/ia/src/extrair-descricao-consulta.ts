import {
  cortar_cadastro_do_texto,
  inferir_origem_da_mensagem,
  nome_corresponde_cadastro,
  normalizar_texto_busca,
} from "./inferir-origem-movimento";
import type { ContextoInterpretacao } from "./prompt";

const TERMO_SO_PERIODO =
  /^(hoje|ontem|anteontem|amanh[aã]|esse|este|neste|nesta|dessa|desta|m[eê]s|semana|ano|atual|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)$/i;

const ESTABELECIMENTO_CONHECIDO =
  /\b(uber|99|ifood|i\s*food|rappi|netflix|spotify|amazon|magazine\s*luiza|magalu|farm[aá]cia|mercado|posto|shell|ipiranga)\b/i;

/**
 * Estabelecimentos frequentes — filtro por `descricao`, não por categoria.
 */
export function extrair_estabelecimento_conhecido(texto: string): string | null {
  const m = ESTABELECIMENTO_CONHECIDO.exec(texto);
  if (!m?.[1]) return null;
  const bruto = m[1].replace(/\s+/g, "").toLocaleLowerCase("pt-BR");
  if (bruto === "ifood") return "ifood";
  if (bruto.startsWith("magazine") || bruto === "magalu") return "magalu";
  if (bruto.startsWith("farm")) return "farmacia";
  return bruto.normalize("NFD").replace(/\p{M}/gu, "");
}

export function categoria_do_contexto(
  termo: string,
  contexto: ContextoInterpretacao,
): string | null {
  const citado = normalizar_texto_busca(termo).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (!citado) return null;
  const encontrada = contexto.categorias.find((item) => {
    const nome = normalizar_texto_busca(item.nome).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
    return nome === citado;
  });
  return encontrada?.nome ?? null;
}

function termo_e_so_origem(
  termo: string,
  origem: { conta_nome?: string; cartao_nome?: string },
): boolean {
  const n = normalizar_texto_busca(termo);
  if (!n) return true;
  if (/^(cart[aã]o|conta)s?$/.test(n)) return true;
  if (origem.cartao_nome && nome_corresponde_cadastro(origem.cartao_nome, termo)) return true;
  if (origem.conta_nome && nome_corresponde_cadastro(origem.conta_nome, termo)) return true;
  if (/^(cart[aã]o|conta)\s+/.test(n) && (origem.cartao_nome || origem.conta_nome)) return true;
  return false;
}

function limpar_termo_consulta(bruto: string, contexto: ContextoInterpretacao): string | null {
  let termo = bruto.replace(/\s+/g, " ").trim();
  termo = termo.replace(/[?.!]+$/g, "").trim();
  const origem = inferir_origem_da_mensagem(termo, contexto);
  if (origem.cartao_nome) termo = cortar_cadastro_do_texto(termo, origem.cartao_nome);
  if (origem.conta_nome) termo = cortar_cadastro_do_texto(termo, origem.conta_nome);
  termo = termo.replace(/\s+(?:do|da|de|no|na)\s+(?:cart[aã]o|conta)\s*$/i, "").trim();
  if (!termo || TERMO_SO_PERIODO.test(termo) || termo.length < 3) return null;
  if (termo_e_so_origem(termo, origem)) return null;
  return termo;
}

/**
 * Texto depois de "lançamentos de X" / "gastos de X" — descrição do Fato,
 * não nome de categoria (isso só vale se X estiver cadastrado como categoria).
 */
export function extrair_descricao_consulta_historico(
  mensagem: string,
  contexto: ContextoInterpretacao,
): string | null {
  const conhecido = extrair_estabelecimento_conhecido(mensagem);
  if (conhecido) return conhecido;

  const texto = mensagem.trim();
  const padrao =
    /\b(?:lan[cç]amentos?|gastos?|despesas?|compras?|extrato)\s+(?:de|da|do|das|dos|com)\s+(.+)$/i;
  const match = padrao.exec(texto);
  if (!match?.[1]) return null;
  return limpar_termo_consulta(match[1], contexto);
}

function limpar_contraparte(nome: string): string {
  return nome
    .replace(/^(?:um\s+)?(?:pix|ted|transfer[eê]ncia)\s+(?:de|da|do)\s+/i, "")
    .replace(/^(?:pix|ted)\s+/i, "")
    .replace(/\s+(?:de|no|via|por)\s+(?:pix|ted)\s*$/i, "")
    .replace(/\bquanto\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function contraparte_util(bruto: string | undefined): string | null {
  if (!bruto) return null;
  const nome = limpar_contraparte(bruto);
  if (nome.length < 2) return null;
  if (/^(pix|ted|transferencia|transferência)$/i.test(nome)) return null;
  if (TERMO_SO_PERIODO.test(nome)) return null;
  return nome;
}

/**
 * "quanto a Tayna Santos me enviou de pix?" → "Tayna Santos".
 * "quanto recebi de pix da Tayna Santos?" → "Tayna Santos".
 * Não usa "pix" como estabelecimento: pix é forma de pagamento.
 */
export function extrair_contraparte_recebimento(mensagem: string): string | null {
  const texto = mensagem.replace(/\s+/g, " ").trim();
  const aMe =
    /\b(?:a|o)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.\s]{0,60}?)\s+me\s+(?:enviou|mandou|transferiu)\b/i.exec(
      texto,
    );
  const doMe = contraparte_util(aMe?.[1]);
  if (doMe) return doMe;

  const recebiPixDe =
    /\b(?:recebi|entrou)\s+(?:um\s+)?(?:de\s+|da\s+|do\s+)?(?:pix|ted)\s+(?:de|da|do)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.\s]{0,60}?)(?:\s*[?.!]?\s*$)/i.exec(
      texto,
    );
  const doPix = contraparte_util(recebiPixDe?.[1]);
  if (doPix) return doPix;

  const recebiDe =
    /\b(?:recebi|entrou)\s+(?:de|da|do)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.\s]{0,60}?)(?:\s+(?:de|no|via|por)\s+pix|\s*[?.!]?\s*$)/i.exec(
      texto,
    );
  return contraparte_util(recebiDe?.[1]);
}
