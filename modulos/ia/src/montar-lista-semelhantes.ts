import { formatarMoeda } from "@lancai/tipos";
import { enxugar_descricao_lancamento } from "./normalizar-descricao";

export type ItemLancamentoSemelhante = {
  id: string;
  descricao: string;
  valor: number;
  dataMovimento: string;
  tipo?: string;
  origemRotulo?: string | null;
};

function formatarData(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split("-");
  return `${dia}/${mes}/${ano}`;
}

function sinal_valor(tipo?: string): "+" | "-" {
  if (tipo === "receita" || tipo === "aporte") return "+";
  return "-";
}

function chave_linha(item: ItemLancamentoSemelhante): string {
  return [
    enxugar_descricao_lancamento(item.descricao),
    Number(item.valor).toFixed(2),
    item.dataMovimento,
    item.origemRotulo?.trim() ?? "",
  ].join("|");
}

/**
 * Lista numerada para desambiguação (WhatsApp): usuário responde 1, 2… ou "todos".
 * Sem #código — o índice é a chave.
 */
export function montar_lista_lancamentos_semelhantes(
  descricao: string,
  itens: ItemLancamentoSemelhante[],
  acao: "excluir" | "corrigir" = "excluir",
): string {
  const rotulos = itens.map((item) => enxugar_descricao_lancamento(item.descricao));
  const rotulosDistintos = new Set(rotulos.map((r) => r.toLocaleLowerCase("pt-BR")));
  const mostrarDescricao = rotulosDistintos.size > 1;

  const chaves = itens.map(chave_linha);
  const tudoIgual = chaves.length > 1 && chaves.every((c) => c === chaves[0]);

  const linhas = itens.map((item, i) => {
    const partes: string[] = [];
    if (mostrarDescricao) partes.push(rotulos[i]!);
    partes.push(`${sinal_valor(item.tipo)} ${formatarMoeda(Number(item.valor))}`);
    partes.push(formatarData(item.dataMovimento));
    if (item.origemRotulo?.trim()) partes.push(item.origemRotulo.trim());
    if (tudoIgual) {
      partes.push(i === 0 ? "mais recente" : i === itens.length - 1 ? "mais antigo" : `opção ${i + 1}`);
    }
    return `${i + 1}. ${partes.join(" · ")}`;
  });

  const rodape =
    acao === "excluir"
      ? `Qual deseja excluir? Digite o número (1, 2…) ou "todos".`
      : `Qual deseja corrigir? Digite o número do lançamento (1, 2…).`;

  return [
    `Encontrei ${itens.length} lançamentos semelhantes a "${descricao}":`,
    ...linhas,
    "",
    rodape,
  ].join("\n");
}
