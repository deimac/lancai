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
  const diaBrasil = dia_civil_iso(ocorridoEmInstante);
  if (diaBrasil && diaBrasil !== dataMovimento.slice(0, 10)) return competencia;
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

/** Soma meses civis preservando o dia (31/01 + 1 mês → 28/02). */
export function somar_meses_calendario(yyyyMmDd: string, meses: number): string {
  const [anoS, mesS, diaS] = yyyyMmDd.split("-");
  const ano = Number(anoS);
  const mes = Number(mesS);
  const dia = Number(diaS);
  if (!ano || !mes || !dia) return yyyyMmDd;
  const base = new Date(Date.UTC(ano, mes - 1 + meses, 1));
  const ultimoDia = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  const diaFinal = Math.min(dia, ultimoDia);
  const y = base.getUTCFullYear();
  const m = String(base.getUTCMonth() + 1).padStart(2, "0");
  const d = String(diaFinal).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Dia civil no fuso do app. Evita `slice(0,10)` de ISO UTC (01/06 22:56 UTC virar 02/06). */
export function dia_civil_iso(quando: string | Date, fuso = "America/Sao_Paulo"): string | null {
  if (typeof quando === "string" && /^\d{4}-\d{2}-\d{2}$/.test(quando)) return quando;
  const data = typeof quando === "string" ? new Date(quando) : quando;
  if (Number.isNaN(data.getTime())) return null;
  if (typeof quando === "string" && !quando.includes("T") && /^\d{4}-\d{2}-\d{2}/.test(quando)) {
    return quando.slice(0, 10);
  }
  return hojeISO(data, fuso);
}

/**
 * Dia que o provedor gravou no `date`. O app do banco usa o calendário UTC do
 * instante (`2026-08-24T00:33:38Z` → 24/08). Converter para o Brasil deslocava
 * madrugada UTC para a véspera.
 */
export function dia_provedor_iso(quando: string, _fuso = "America/Sao_Paulo"): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(quando)) return quando;
  const data = new Date(quando);
  if (Number.isNaN(data.getTime())) return quando.slice(0, 10);
  return data.toISOString().slice(0, 10);
}

export function dias_calendario_entre(a: string, b: string): number {
  const da = deISOParaData(a.slice(0, 10)).getTime();
  const db = deISOParaData(b.slice(0, 10)).getTime();
  return Math.round(Math.abs(da - db) / 86_400_000);
}

/** Compra no mesmo dia civil ou no vizinho (±1) — fuso que vira o dia na Pluggy. */
export function datas_civis_proximas(a: string, b: string, maxDias = 1): boolean {
  const da = a.slice(0, 10);
  const db = b.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(da) || !/^\d{4}-\d{2}-\d{2}$/.test(db)) return da === db;
  return dias_calendario_entre(da, db) <= maxDias;
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
 * Data de vencimento da fatura em que uma compra feita em `dataCompra` vai cair.
 * Compra até o fechamento entra neste ciclo; o vencimento é no mês seguinte ao
 * fechamento (fecha 20 → vence 27/08; Azul fecha 30/06 → vence 06/07).
 */
export function calcularDataVencimentoFatura(
  dataCompra: Date,
  fechamento: number,
  vencimento: number,
): Date {
  const diaCompra = dataCompra.getUTCDate();
  const diaFecha = Math.min(Math.max(1, fechamento), 31);
  const diaVence = Math.min(Math.max(1, vencimento), 28);
  const entrouAposFechamento = diaCompra > diaFecha;
  const mesFechamento = dataCompra.getUTCMonth() + (entrouAposFechamento ? 1 : 0);
  const mesVencimento = mesFechamento + 1;
  return new Date(Date.UTC(dataCompra.getUTCFullYear(), mesVencimento, diaVence));
}

/** Mês da fatura em que a compra conta (YYYY-MM), não o mês do lançamento. */
export function competencia_fatura_da_compra(
  dataCompraISO: string,
  fechamento: number,
  vencimento: number,
): string {
  const venc = calcularDataVencimentoFatura(
    deISOParaData(dataCompraISO.slice(0, 10)),
    fechamento,
    vencimento,
  );
  return paraDataISO(venc).slice(0, 7);
}

/**
 * Quando a parcela aparece no extrato. Prefere o mês da fatura (`billForecastDate`).
 * Sem forecast, usa fechamento/vencimento e espaça N a partir da 1ª competência.
 */
export function data_movimento_parcela(entrada: {
  numero: number;
  compraEm?: string | null;
  billForecastDate?: string | null;
  dateProvedor?: string | null;
  fechamento?: number;
  vencimento?: number;
}): string {
  const numero = Math.max(1, entrada.numero);
  const forecast = entrada.billForecastDate?.trim() ?? "";
  const dateDia = entrada.dateProvedor?.slice(0, 10) ?? "";
  if (/^\d{4}-\d{2}$/.test(forecast)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateDia) && dateDia.startsWith(`${forecast}-`)) return dateDia;
    return `${forecast}-01`;
  }

  const compra =
    (entrada.compraEm && /^\d{4}-\d{2}-\d{2}$/.test(entrada.compraEm) ? entrada.compraEm : null) ??
    (/^\d{4}-\d{2}-\d{2}$/.test(dateDia) ? dateDia : null);

  if (
    compra &&
    entrada.fechamento != null &&
    entrada.vencimento != null &&
    entrada.fechamento >= 1 &&
    entrada.vencimento >= 1
  ) {
    const primeira = competencia_fatura_da_compra(compra, entrada.fechamento, entrada.vencimento);
    return somar_meses_calendario(`${primeira}-01`, numero - 1);
  }

  if (compra) return somar_meses_calendario(compra, numero - 1);
  return dateDia || compra || "";
}

/**
 * Na mesma série, no máximo uma parcela por mês. Número maior avança um ciclo.
 */
export function garantir_parcelas_subsequentes(
  itens: Array<{ numero: number; dataMovimento: string }>,
): Map<number, string> {
  const ordenados = [...itens]
    .filter((item) => item.numero >= 1 && /^\d{4}-\d{2}-\d{2}$/.test(item.dataMovimento))
    .sort((a, b) => a.numero - b.numero);
  const saida = new Map<number, string>();
  let anterior: string | null = null;
  for (const item of ordenados) {
    let data = item.dataMovimento;
    if (anterior && data.slice(0, 7) <= anterior.slice(0, 7)) {
      data = somar_meses_calendario(`${anterior.slice(0, 7)}-01`, 1);
    }
    saida.set(item.numero, data);
    anterior = data;
  }
  return saida;
}

/** Se a parcela ainda está no mês da compra, desloca para a competência da fatura. */
export function coerir_data_parcela_cartao(entrada: {
  ocorridoEm: string;
  numero?: number | null;
  compraEm?: string | null;
  fechamento?: number;
  vencimento?: number;
}): string {
  const numero = entrada.numero;
  const compra = entrada.compraEm?.slice(0, 10);
  const ocorrido = entrada.ocorridoEm.slice(0, 10);
  if (!numero || numero < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(ocorrido)) return entrada.ocorridoEm;

  const noMesDaCompra = Boolean(compra && /^\d{4}-\d{2}-\d{2}$/.test(compra) && ocorrido.slice(0, 7) === compra.slice(0, 7));
  if (!noMesDaCompra) return ocorrido;

  if (entrada.fechamento != null && entrada.vencimento != null && compra) {
    return data_movimento_parcela({
      numero,
      compraEm: compra,
      fechamento: entrada.fechamento,
      vencimento: entrada.vencimento,
    });
  }

  if (numero >= 2 && compra) return somar_meses_calendario(compra, numero - 1);
  return ocorrido;
}
