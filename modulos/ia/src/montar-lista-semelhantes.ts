import { formatarDataHoraBrasil, formatarMoeda } from "@lancai/tipos";

export type ItemLancamentoSemelhante = {
  id: string;
  descricao: string;
  valor: number;
  dataMovimento: string;
  /** Momento em que o lançamento foi gravado (timestamp). */
  dataLancamento?: Date | string | null;
  tipo?: string;
  origemRotulo?: string | null;
  /** Fato vindo do banco ou em conta sincronizada: não aceita correção nem exclusão. */
  protegido?: boolean;
};

function sinal_valor(tipo?: string): "+" | "-" {
  if (tipo === "receita" || tipo === "aporte") return "+";
  return "-";
}

function formatar_quando(item: ItemLancamentoSemelhante): string {
  if (item.dataLancamento) {
    const formatado = formatarDataHoraBrasil(item.dataLancamento);
    if (formatado) return formatado;
  }
  const [ano, mes, dia] = item.dataMovimento.split("-");
  return `${dia}/${mes}/${ano}`;
}

/**
 * Lista numerada para desambiguação (WhatsApp): usuário responde 1, 2… ou "todos".
 * Mostra a descrição original e o horário do lançamento.
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
      formatar_quando(item),
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
