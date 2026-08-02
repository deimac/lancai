/**
 * Monta a pergunta de confirmação antes de excluir conta/cartão.
 * Se houver lançamentos vinculados, reforça o aviso com a quantidade.
 */
export function montar_confirmacao_exclusao(
  tipo: "conta" | "cartão",
  nome: string,
  totalLancamentos: number,
): string {
  const artigo = tipo === "conta" ? "a" : "o";
  const base = `Deseja realmente excluir ${artigo} ${tipo} "${nome}"?`;

  if (totalLancamentos <= 0) {
    return `${base} Responda "sim" para confirmar ou "não" para cancelar.`;
  }

  const rotulo =
    totalLancamentos === 1
      ? "existe 1 lançamento vinculado"
      : `existem ${totalLancamentos} lançamentos vinculados`;

  return `${base} Atenção: ${rotulo} a ${artigo === "a" ? "essa" : "esse"} ${tipo} — ${artigo} ${tipo} some da listagem, mas o histórico dos lançamentos é preservado. Responda "sim" para confirmar ou "não" para cancelar.`;
}
