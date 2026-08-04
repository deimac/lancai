import { formatarMoeda } from "@lancai/tipos";

function formatarData(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split("-");
  return `${dia}/${mes}/${ano}`;
}

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

/** Pergunta de confirmação antes de cancelar um ou vários lançamentos. */
export function montar_confirmacao_exclusao_lancamento(
  descricao: string,
  dataMovimento: string | null,
  valorTotal: number,
  quantidade = 1,
): string {
  const data = dataMovimento ? ` de ${formatarData(dataMovimento)}` : "";
  if (quantidade <= 1) {
    return `Deseja realmente excluir o lançamento "${descricao}"${data} (${formatarMoeda(valorTotal)})? Responda "sim" para confirmar ou "não" para cancelar.`;
  }
  return `Deseja realmente excluir os ${quantidade} lançamentos de "${descricao}"${data} (total ${formatarMoeda(valorTotal)})? Responda "sim" para confirmar ou "não" para cancelar.`;
}

/** Pergunta quando já existe lançamento com mesmo valor, data, lugar e origem. */
export function montar_confirmacao_duplicata_lancamento(
  descricao: string,
  dataMovimento: string,
  valor: number,
  origemRotulo: string,
): string {
  const origem = origemRotulo ? ` ${origemRotulo}` : "";
  return `Já existe um lançamento igual: "${descricao}" de ${formatarData(dataMovimento)} (${formatarMoeda(valor)})${origem}. Deseja registrar mesmo assim? Responda "sim" para confirmar ou "não" para cancelar.`;
}
