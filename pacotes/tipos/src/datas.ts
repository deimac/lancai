/**
 * Helpers de data usados pelas regras de fechamento/vencimento de cartão e parcelamento.
 * Assumem meses "civis" (sem fuso), então sempre trabalhe com `Date` em UTC ou em
 * strings `YYYY-MM-DD` para evitar deslocamento de dia por timezone.
 */

/** "Hoje" no fuso do app (padrão Brasil). Evita `toISOString()` que usa UTC. */
export function hojeISO(agora: Date = new Date(), fuso = "America/Sao_Paulo"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

export function paraDataISO(data: Date): string {
  return data.toISOString().slice(0, 10);
}

export function deISOParaData(dataISO: string): Date {
  const partes = dataISO.split("-");
  const ano = Number(partes[0]);
  const mes = Number(partes[1]);
  const dia = Number(partes[2]);
  if (!ano || !mes || !dia) {
    throw new Error(`Data ISO inválida: ${dataISO}`);
  }
  return new Date(Date.UTC(ano, mes - 1, dia));
}

export function adicionarMeses(data: Date, quantidade: number): Date {
  return new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth() + quantidade, data.getUTCDate()));
}

/**
 * Dia seguinte ao fechamento — considerado o "melhor dia de compra" no cartão,
 * pois maximiza o prazo até o vencimento da fatura. Representado como número de dia
 * (1-31); quando o fechamento cai no último dia do mês, aponta para o dia 1.
 */
export function calcularMelhorDiaCompra(fechamento: number): number {
  return fechamento >= 31 ? 1 : fechamento + 1;
}

/**
 * Data de vencimento da fatura em que uma compra feita em `dataCompra` vai cair,
 * dado o dia de `fechamento` e o dia de `vencimento` do cartão.
 * Regra: se a compra ocorre depois do fechamento do mês corrente, ela entra na
 * fatura que fecha no mês seguinte (cujo vencimento é o mês seguinte a esse).
 */
export function calcularDataVencimentoFatura(
  dataCompra: Date,
  fechamento: number,
  vencimento: number,
): Date {
  const diaCompra = dataCompra.getUTCDate();
  const entrouAposFechamento = diaCompra > fechamento;
  const mesFechamento = dataCompra.getUTCMonth() + (entrouAposFechamento ? 1 : 0);
  return new Date(Date.UTC(dataCompra.getUTCFullYear(), mesFechamento + 1, vencimento));
}
