import {
  enxugar_descricao_lancamento,
  formatar_codigo_movimento,
} from "@lancai/ia";
import { formatarMoeda } from "@lancai/tipos";

function formatarData(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split("-");
  return `${dia}/${mes}/${ano}`;
}

export type ItemLancamentoSemelhante = {
  id: string;
  descricao: string;
  valor: number;
  dataMovimento: string;
  tipo?: string;
};

function sinal_valor(tipo?: string): "+" | "-" {
  if (tipo === "receita" || tipo === "aporte") return "+";
  return "-";
}

/** Lista candidatos ambíguos com código curto para o usuário escolher. */
export function montar_lista_lancamentos_semelhantes(
  descricao: string,
  itens: ItemLancamentoSemelhante[],
  acao: "excluir" | "corrigir" = "excluir",
): string {
  const linhas = itens.map((item) => {
    const rotulo = enxugar_descricao_lancamento(item.descricao);
    const valor = `${sinal_valor(item.tipo)} ${formatarMoeda(Number(item.valor))}`;
    return `- ${formatar_codigo_movimento(item.id)} · ${rotulo} · ${valor} · ${formatarData(item.dataMovimento)}`;
  });
  const exemplo = itens[0] ? formatar_codigo_movimento(itens[0].id) : "#a1b2c3d4";
  const rodape =
    acao === "excluir"
      ? `Qual deseja excluir? Use o código (ex.: "Cancela o ${exemplo}") ou diga "todos".`
      : `Qual deseja corrigir? Use o código (ex.: "Corrige o ${exemplo}").`;

  return [
    `Encontrei ${itens.length} lançamentos semelhantes a "${descricao}":`,
    ...linhas,
    "",
    rodape,
  ].join("\n");
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
