import {
  formatar_codigo_movimento,
  montar_lista_lancamentos_semelhantes,
  type ItemLancamentoSemelhante,
} from "@lancai/ia";
import { formatarMoeda } from "@lancai/tipos";

export type { ItemLancamentoSemelhante };
export { montar_lista_lancamentos_semelhantes };

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
  movimentoId: string | null = null,
  itens: ItemLancamentoSemelhante[] = [],
): string {
  if (quantidade > 1 && itens.length > 1) {
    return montar_lista_lancamentos_semelhantes(descricao, itens, "excluir");
  }

  const data = dataMovimento ? ` de ${formatarData(dataMovimento)}` : "";
  const codigo = movimentoId ? ` ${formatar_codigo_movimento(movimentoId)}` : "";
  return `Deseja realmente excluir o lançamento "${descricao}"${codigo}${data} (${formatarMoeda(valorTotal)})? Responda "sim" para confirmar ou "não" para cancelar.`;
}

/**
 * Recusa de exclusão de lançamento que vive em conta conectada ao banco. Não é
 * uma pergunta: é a resposta final, e por isso precisa oferecer o caminho que
 * existe — esconder do relatório, que resolve o que o usuário realmente quer.
 */
export function montar_recusa_exclusao_protegida(descricao: string, origens: string[]): string {
  const unicas = [...new Set(origens.filter((origem) => origem.trim()))];
  const onde =
    unicas.length === 1
      ? ` em ${unicas[0]}`
      : unicas.length > 1
        ? ` em ${unicas.slice(0, -1).join(", ")} e ${unicas.at(-1)}`
        : "";

  return (
    `O lançamento "${descricao}"${onde} veio do banco, então não consigo apagá-lo — ` +
    `o extrato é a fonte da verdade e ele voltaria na próxima sincronização.\n\n` +
    `Se a ideia é tirar isso das suas contas, diga "não considera ${descricao} nos relatórios" ` +
    `que eu escondo dos totais sem mexer no histórico. Categoria, descrição e ` +
    `observações eu também mudo normalmente.`
  );
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
