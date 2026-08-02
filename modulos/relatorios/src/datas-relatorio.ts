import { adicionarMeses, deISOParaData, paraDataISO } from "@lancai/tipos";

/** Primeiro e último dia do mês em que `dataAtual` cai (ex.: "2026-08-15" -> 2026-08-01..2026-08-31). */
export function inicioFimMesAtual(dataAtual: string): { de: string; ate: string } {
  const data = deISOParaData(dataAtual);
  const inicio = new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), 1));
  const fim = new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth() + 1, 0));
  return { de: paraDataISO(inicio), ate: paraDataISO(fim) };
}

/** 31 de dezembro do ano de `dataAtual` — padrão de "até quando" para a visão "futuro". */
export function fimDoAno(dataAtual: string): string {
  const data = deISOParaData(dataAtual);
  return `${data.getUTCFullYear()}-12-31`;
}

/** Intervalo cobrindo os últimos `quantidade` meses (incluindo o mês de `dataAtual`), para a visão "evolução". */
export function ultimosMeses(dataAtual: string, quantidade: number): { de: string; ate: string } {
  const data = deISOParaData(dataAtual);
  const primeiroDiaDoMesAtual = new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), 1));
  const inicio = adicionarMeses(primeiroDiaDoMesAtual, -(quantidade - 1));
  return { de: paraDataISO(inicio), ate: dataAtual };
}

/** Lista de meses ("YYYY-MM") entre `de` e `ate`, inclusive — usada para não deixar buracos na evolução mensal. */
export function listarMesesEntre(de: string, ate: string): string[] {
  const inicio = deISOParaData(de);
  const fim = deISOParaData(ate);
  const meses: string[] = [];

  let cursor = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth(), 1));
  const limite = new Date(Date.UTC(fim.getUTCFullYear(), fim.getUTCMonth(), 1));

  while (cursor.getTime() <= limite.getTime()) {
    meses.push(paraDataISO(cursor).slice(0, 7));
    cursor = adicionarMeses(cursor, 1);
  }

  return meses;
}
