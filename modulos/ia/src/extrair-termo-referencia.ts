import {
  enxugar_descricao_lancamento,
  limpar_termo_descricao,
  normalizar_descricao,
  rotulo_descricao_busca,
} from "./normalizar-descricao";

function dedupe_palavras(texto: string): string {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const palavra of texto.split(/\s+/).filter(Boolean)) {
    const chave = normalizar_descricao(palavra);
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(palavra);
  }
  return saida.join(" ");
}

function limpar_captura_referencia(bruto: string): string | null {
  let termo = bruto
    .replace(/\b(?:lan[cç]amentos?|despesas?|compras?|gastos?)\b/gi, " ")
    .replace(/\b(?:para\s+)?uso\s+pessoal\b|\bgasto\s+pessoal\b|\bda\s+empresa\b/gi, " ");
  termo = dedupe_palavras(limpar_termo_descricao(termo));
  if (termo.length < 2) return null;
  // Núcleo curto para busca/exibição ("compra de um tênis…" → "Tênis").
  return enxugar_descricao_lancamento(termo);
}

/**
 * Preferência: termo que o usuário escreveu na mensagem de cancelar/corrigir
 * (ex.: "farmacia" em "apague o lançamento de farmacia de hoje").
 */
export function extrair_termo_referencia_mensagem(mensagem: string): string | null {
  const texto = mensagem.trim();
  if (!texto) return null;

  // "apague o lançamento de farmacia de hoje" OU "apague lançamento compra de tênis…"
  const padrao =
    /\b(?:apague|apaga|apagar|exclua|exclui|excluir|cancele|cancela|cancelar|remova|remove|remover|delete|deletar)\b(?:\s+(?:o|a|os|as))?(?:\s+(?:lan[cç]amentos?|despesas?|compras?|gastos?))?(?:\s+(?:de|do|da))?\s+(.+?)(?:\s+de\s+(?:hoje|ontem|anteontem|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)|\s*[.!]?\s*$)/i;

  const match = padrao.exec(texto);
  if (match?.[1]) {
    const termo = limpar_captura_referencia(match[1]);
    if (termo) return termo;
  }

  // Fallback: "cancela o almoço de ontem" / "corrige o uber de hoje"
  // Não corta em "para" (ex.: "…tênis para uso pessoal").
  const padraoSimples =
    /\b(?:cancela|cancele|cancelar|apaga|apague|apagar|exclui|exclua|excluir|corrige|corrija|corrigir)\b(?:\s+(?:o|a|os|as))?\s+(.+?)(?:\s+de\s+(?:hoje|ontem|anteontem|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)|\s+para\s+(?:r\$|reais)?\s*\d|\s*$)/i;
  const simples = padraoSimples.exec(texto);
  if (simples?.[1]) {
    const termo = limpar_captura_referencia(simples[1]);
    if (termo) return termo;
  }

  return null;
}

/** Escolhe o melhor rótulo: palavra do usuário > limpeza do termo da IA. */
export function preferir_termo_referencia(
  mensagem: string,
  descricaoIa?: string | null,
): string | null {
  return (
    extrair_termo_referencia_mensagem(mensagem) ??
    (descricaoIa ? rotulo_descricao_busca(descricaoIa) : null)
  );
}
