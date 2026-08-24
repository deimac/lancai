import { formatarMoeda, formatarQuandoFato } from "@lancai/tipos";

export type ItemLancamentoSemelhante = {
  id: string;
  descricao: string;
  valor: number;
  dataMovimento: string;
  /** Instante da instituição, quando existe hora além do dia. */
  ocorridoEmInstante?: Date | string | null;
  tipo?: string;
  origemRotulo?: string | null;
  /** Fato vindo do banco ou em conta sincronizada: não aceita correção nem exclusão. */
  protegido?: boolean;
};

function sinal_valor(tipo?: string): "+" | "-" {
  if (tipo === "receita" || tipo === "aporte") return "+";
  return "-";
}

/**
 * Lista numerada para desambiguação. A data é a do Fato (Extrato), nunca a da importação.
 */
export function montar_lista_lancamentos_semelhantes(
  _descricaoBusca: string,
  itens: ItemLancamentoSemelhante[],
  acao: "excluir" | "corrigir" = "excluir",
): string {
  const linhas = itens.map((item, i) => {
    const partes = [
      item.descricao.trim() || "Lançamento",
      `${sinal_valor(item.tipo)} ${formatarMoeda(Number(item.valor))}`,
      formatarQuandoFato(item.dataMovimento, item.ocorridoEmInstante),
    ];
    if (item.origemRotulo?.trim()) partes.push(item.origemRotulo.trim());
    return `${i + 1}. ${partes.join(" · ")}`;
  });

  const rodape =
    acao === "excluir"
      ? `Qual deseja excluir (apagar)? Digite o número (1, 2…) ou "todos". Isso remove o lançamento.`
      : `Qual deseja corrigir (alterar — não apaga)? Digite o número do lançamento (1, 2…).`;

  return [`Encontrei ${itens.length} lançamentos:`, ...linhas, "", rodape].join("\n");
}
