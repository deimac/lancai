/**
 * Decide se a consulta de histórico deve listar lançamentos ou só totais.
 * - "quanto gastei…", "total", "resumo" → só soma
 * - "detalhado", "extrato", "liste", "quais", "mostra" (sem quanto) → lista
 */
export function consulta_historico_detalhada(mensagem: string): boolean {
  const texto = mensagem.toLocaleLowerCase("pt-BR").trim();
  if (!texto) return true;

  if (/\b(detalhad[oa]s?|um\s+a\s+um|item\s+a\s+item)\b/.test(texto)) return true;

  const pedeSoma =
    /\bquanto\b/.test(texto) ||
    /\b(total|soma|somatória|somatoria)\b/.test(texto) ||
    /\bresumo\b/.test(texto);

  const pedeLista =
    /\b(extrato|liste|listar|quais|mostra|mostre|veja|ver|tiv[eé]|teve)\b/.test(texto) ||
    /\bo\s+que\s+(eu\s+)?(lancei|gastei|paguei)\b/.test(texto);

  if (pedeSoma && !/\bdetalhad/.test(texto)) return false;
  if (pedeLista && !pedeSoma) return true;
  if (pedeSoma) return false;

  return true;
}
