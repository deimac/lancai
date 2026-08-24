/** Soma dias em uma data ISO (YYYY-MM-DD) sem efeito de fuso. */
export function somar_dias_iso_local(dataISO: string, dias: number): string {
  const data = new Date(`${dataISO}T12:00:00.000Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

const DATA_BR = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,5}))?\b/;

function normalizar_ano_br(bruto: string | undefined, dataAtual: string): string {
  const fallback = /^\d{4}/.test(dataAtual) ? dataAtual.slice(0, 4) : "2026";
  if (!bruto) return fallback;
  if (bruto.length === 2) {
    const n = Number(bruto);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return n >= 90 ? `19${bruto}` : `20${bruto.padStart(2, "0")}`;
  }
  if (bruto.length === 4) {
    const n = Number(bruto);
    return n >= 1990 && n <= 2100 ? bruto : fallback;
  }
  // Typo comum: 20026 no lugar de 2026 (zero extra no meio de 20xx).
  if (bruto.length === 5 && /^20\d{3}$/.test(bruto)) {
    const tentativa = `20${bruto.slice(-2)}`;
    const n = Number(tentativa);
    if (n >= 1990 && n <= 2100) return tentativa;
  }
  return fallback;
}

function montar_iso(dia: number, mes: number, ano: string): string | null {
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Converte "15/08/2026", "15/08", "15/08/20026" (typo) em YYYY-MM-DD. */
export function parsear_data_br(texto: string, dataAtual: string): string | null {
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(texto);
  if (iso) {
    const ano = Number(iso[1]);
    const mes = Number(iso[2]);
    const dia = Number(iso[3]);
    if (ano >= 1990 && ano <= 2100 && mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31) {
      return `${iso[1]}-${iso[2]}-${iso[3]}`;
    }
  }
  const m = DATA_BR.exec(texto);
  if (!m) return null;
  return montar_iso(Number(m[1]), Number(m[2]), normalizar_ano_br(m[3], dataAtual));
}

/**
 * Data alvo após "para" (correção de lançamento) ou relativa no trecho:
 * "para 15/08/2026", "para hoje", "para ontem".
 */
export function parsear_data_apos_para(texto: string, dataAtual: string): string | null {
  const aposPara = /\bpara\s+(?:o\s+dia\s+|dia\s+)?(.+?)\s*$/i.exec(texto.trim());
  const trecho = (aposPara?.[1] ?? texto).trim();
  return parsear_data_relativa_ou_br(trecho, dataAtual);
}

export function parsear_data_relativa_ou_br(texto: string, dataAtual: string): string | null {
  const lower = texto
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (/\banteontem\b/.test(lower)) return somar_dias_iso_local(dataAtual, -2);
  if (/\bontem\b/.test(lower)) return somar_dias_iso_local(dataAtual, -1);
  if (/\bhoje\b/.test(lower)) return dataAtual;
  if (/\bamanha\b/.test(lower)) return somar_dias_iso_local(dataAtual, 1);
  return parsear_data_br(texto, dataAtual);
}

/** Intervalo amplo para "todos os lançamentos" (sem amarrar no mês atual). */
export function periodo_historico_completo(dataAtual: string): { de: string; ate: string } {
  return { de: "2000-01-01", ate: dataAtual };
}

/** Primeiro e último dia do mês de `dataISO` (YYYY-MM-DD). */
export function inicio_fim_mes_iso(dataISO: string): { de: string; ate: string } {
  const [ano, mes] = dataISO.split("-").map(Number) as [number, number];
  const inicio = `${ano}-${String(mes).padStart(2, "0")}-01`;
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const fim = `${ano}-${String(mes).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}`;
  return { de: inicio, ate: fim };
}

export type PeriodoConsulta = { de: string; ate: string };

type PeriodSpecConsulta = {
  tipo: "mes_atual" | "mes_passado" | "ultimos_n_meses" | "ano_atual" | "personalizado";
  de?: string;
  ate?: string;
  nMeses?: number;
};

function mes_anterior_iso(dataISO: string): string {
  const [ano, mes] = dataISO.split("-").map(Number) as [number, number];
  if (mes === 1) return `${ano - 1}-12-01`;
  return `${ano}-${String(mes - 1).padStart(2, "0")}-01`;
}

function inicio_n_meses_atras(dataISO: string, nMeses: number): string {
  const [ano, mes] = dataISO.split("-").map(Number) as [number, number];
  let y = ano;
  let m = mes - (nMeses - 1);
  while (m <= 0) {
    m += 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/**
 * PeriodSpec do assistente (mes_atual, mes_passado…) → intervalo ISO para o relatório.
 * Sem isto, `mes_passado` cai no default do mês atual e o número fica errado.
 */
export function resolver_periodo_spec(
  period: PeriodSpecConsulta | undefined,
  dataAtual: string,
): PeriodoConsulta | undefined {
  if (!period) return undefined;
  if (period.de && period.ate) return { de: period.de, ate: period.ate };

  if (period.tipo === "mes_atual") return inicio_fim_mes_iso(dataAtual);
  if (period.tipo === "mes_passado") return inicio_fim_mes_iso(mes_anterior_iso(dataAtual));
  if (period.tipo === "ano_atual") {
    const ano = dataAtual.slice(0, 4);
    return { de: `${ano}-01-01`, ate: `${ano}-12-31` };
  }
  if (period.tipo === "ultimos_n_meses") {
    const n = period.nMeses && period.nMeses > 0 ? period.nMeses : 6;
    return { de: inicio_n_meses_atras(dataAtual, n), ate: dataAtual };
  }
  if (period.tipo === "personalizado" && period.de) {
    return { de: period.de, ate: period.ate ?? period.de };
  }
  return undefined;
}
