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

/** Data + hora no fuso do app (ex.: `05/08/2026 14:32`). */
export function formatarDataHoraBrasil(
  quando: Date | string,
  fuso = "America/Sao_Paulo",
): string {
  const data = typeof quando === "string" ? new Date(quando) : quando;
  if (Number.isNaN(data.getTime())) return "";
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: fuso,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(data);
  const pegar = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((parte) => parte.type === tipo)?.value ?? "";
  return `${pegar("day")}/${pegar("month")}/${pegar("year")} ${pegar("hour")}:${pegar("minute")}`;
}

/**
 * Hora civil `HH:mm` no fuso do app. Meia-noite UTC (o que a Pluggy manda quando
 * só tem o dia) vira `00:00`, sem deslocar para o dia anterior.
 */
export function formatarHoraBrasil(
  quando: Date | string,
  fuso = "America/Sao_Paulo",
): string {
  const data = typeof quando === "string" ? new Date(quando) : quando;
  if (Number.isNaN(data.getTime())) return "";
  const soDia =
    data.getUTCHours() === 0 &&
    data.getUTCMinutes() === 0 &&
    data.getUTCSeconds() === 0 &&
    data.getUTCMilliseconds() === 0;
  if (soDia) return "00:00";
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: fuso,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(data);
  const pegar = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((parte) => parte.type === tipo)?.value ?? "";
  const hora = pegar("hour").padStart(2, "0");
  const minuto = pegar("minute").padStart(2, "0");
  return hora && minuto ? `${hora}:${minuto}` : "";
}

/**
 * Data civil do Fato (`YYYY-MM-DD`) e hora da instituição, se existir.
 * Nunca use `dataLancamento` (momento da importação/gravação).
 */
export function formatarQuandoFato(
  dataMovimento: string,
  ocorridoEmInstante?: Date | string | null,
): string {
  const [ano, mes, dia] = dataMovimento.split("-");
  const competencia = ano && mes && dia ? `${dia}/${mes}/${ano}` : dataMovimento;
  if (!ocorridoEmInstante) return competencia;
  const hora = formatarHoraBrasil(ocorridoEmInstante);
  if (!hora || hora === "00:00") return competencia;
  return `${competencia} ${hora}`;
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
