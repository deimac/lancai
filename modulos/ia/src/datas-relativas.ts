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

function normalizar_sem_acento(texto: string): string {
  return texto
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

const DIAS_SEMANA: Array<{ weekday: number; re: RegExp; rotulo: string; chave: string }> = [
  { weekday: 0, re: /\bdomingos?\b/, rotulo: "Domingo", chave: "domingo" },
  { weekday: 6, re: /\bsabados?\b/, rotulo: "Sábado", chave: "sabado" },
  { weekday: 1, re: /\bsegundas?-feiras?\b/, rotulo: "Segunda", chave: "segunda" },
  { weekday: 2, re: /\btercas?(?:-feiras?)?\b/, rotulo: "Terça", chave: "terca" },
  { weekday: 3, re: /\bquartas?(?:-feiras?)?\b/, rotulo: "Quarta", chave: "quarta" },
  { weekday: 4, re: /\bquintas?(?:-feiras?)?\b/, rotulo: "Quinta", chave: "quinta" },
  { weekday: 5, re: /\bsextas?(?:-feiras?)?\b/, rotulo: "Sexta", chave: "sexta" },
];

const INDICE_DIA_EN: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/** Última ocorrência do weekday (0=domingo) em ou antes de `dataAtual`. */
export function data_do_ultimo_dia_da_semana(dataAtual: string, weekday: number): string {
  const atual = new Date(`${dataAtual}T12:00:00.000Z`).getUTCDay();
  const delta = (atual - weekday + 7) % 7;
  return somar_dias_iso_local(dataAtual, -delta);
}

export type DiaSemanaExtraido = { iso: string; rotulo: string; chave: string };

/**
 * "e domingo?", "no sábado", "terça-feira".
 * "segunda" solta só conta com prefixo (e/na/de) — evita "segunda parcela".
 */
export function extrair_dia_da_semana(texto: string, dataAtual: string): DiaSemanaExtraido | null {
  const lower = normalizar_sem_acento(texto);
  const en = INDICE_DIA_EN[lower.trim()];
  if (en !== undefined) {
    const dia = DIAS_SEMANA.find((item) => item.weekday === en);
    return {
      iso: data_do_ultimo_dia_da_semana(dataAtual, en),
      rotulo: dia?.rotulo ?? "Dia",
      chave: dia?.chave ?? lower.trim(),
    };
  }
  for (const dia of DIAS_SEMANA) {
    if (dia.re.test(lower)) {
      return {
        iso: data_do_ultimo_dia_da_semana(dataAtual, dia.weekday),
        rotulo: dia.rotulo,
        chave: dia.chave,
      };
    }
  }
  if (!/\bsegundas?\b/.test(lower)) return null;
  if (/\bsegunda\s+parcela/.test(lower) || /\bem\s+segundo\b/.test(lower)) return null;
  const followup = /^(?:e\s+)?(?:n[oa]\s+)?segundas?(?:-feira)?\??\.?$/.test(lower.trim());
  const comPrefixo = /\b(?:e|n[oa]|de|do|da|em)\s+segundas?\b/.test(lower);
  if (!followup && !comPrefixo) return null;
  return {
    iso: data_do_ultimo_dia_da_semana(dataAtual, 1),
    rotulo: "Segunda",
    chave: "segunda",
  };
}

export type OrigemPeriodoRelativo =
  | "ontem"
  | "hoje"
  | "anteontem"
  | "amanha"
  | "dia_semana"
  | "mes_atual"
  | "mes_passado"
  | "data";

export type PeriodoRelativo = {
  de: string;
  ate: string;
  origem: OrigemPeriodoRelativo;
  nomeDia?: string;
};

/**
 * Frase de follow-up temporal: "e no sábado?", "domingo?", "e mês passado?".
 * "e no cartão?" também começa com "e", mas só conta como período se
 * `periodo_relativo_da_mensagem` achar âncora.
 */
export function parece_frase_followup_periodo(texto: string): boolean {
  const t = texto.trim();
  if (/^e\b/i.test(t)) return true;
  const compacto = t.replace(/[?.!]/g, "").trim();
  return /^(?:(?:n[oa]|em|de)\s+)?(?:ontem|hoje|anteontem|amanh[aã]|domingo|s[aá]bado|segunda(?:-feira)?|ter[cç]a(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|(?:este|esse|n?este)\s+m[eê]s|m[eê]s\s+passado)$/i.test(
    compacto,
  );
}

export function eh_followup_periodo(texto: string, dataAtual: string): boolean {
  if (!parece_frase_followup_periodo(texto)) return false;
  return periodo_relativo_da_mensagem(texto, dataAtual) != null;
}

/** Intervalo ISO a partir de ontem/hoje/domingo/mês passado na mensagem. */
export function periodo_relativo_da_mensagem(texto: string, dataAtual: string): PeriodoRelativo | null {
  const lower = normalizar_sem_acento(texto);
  if (/\banteontem\b/.test(lower)) {
    const iso = somar_dias_iso_local(dataAtual, -2);
    return { de: iso, ate: iso, origem: "anteontem" };
  }
  if (/\bontem\b/.test(lower)) {
    const iso = somar_dias_iso_local(dataAtual, -1);
    return { de: iso, ate: iso, origem: "ontem" };
  }
  if (/\bhoje\b/.test(lower)) {
    return { de: dataAtual, ate: dataAtual, origem: "hoje" };
  }
  if (/\bamanha\b/.test(lower)) {
    const iso = somar_dias_iso_local(dataAtual, 1);
    return { de: iso, ate: iso, origem: "amanha" };
  }
  const dia = extrair_dia_da_semana(texto, dataAtual);
  if (dia) {
    return { de: dia.iso, ate: dia.iso, origem: "dia_semana", nomeDia: dia.rotulo };
  }
  if (/\bmes\s+passado\b/.test(lower)) {
    const p = resolver_periodo_spec({ tipo: "mes_passado" }, dataAtual);
    return p ? { de: p.de, ate: p.ate, origem: "mes_passado" } : null;
  }
  if (/\b(?:(?:n?este|esse)\s+mes|mes\s+atual)\b/.test(lower)) {
    const p = resolver_periodo_spec({ tipo: "mes_atual" }, dataAtual);
    return p ? { de: p.de, ate: p.ate, origem: "mes_atual" } : null;
  }
  const br = parsear_data_br(texto, dataAtual);
  if (br) return { de: br, ate: br, origem: "data" };
  return null;
}

export function formatar_data_iso_br(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split("-");
  return `${dia}/${mes}/${ano}`;
}

/** Quando o usuário diz "domingo" e aquele dia foi ontem (ou é hoje). */
export function nota_dia_semana_coincide_hoje_ontem(
  mensagem: string,
  dataAtual: string,
): string | null {
  const dia = extrair_dia_da_semana(mensagem, dataAtual);
  if (!dia) return null;
  const ontem = somar_dias_iso_local(dataAtual, -1);
  if (dia.iso === ontem) return `${dia.rotulo} foi ontem (${formatar_data_iso_br(dia.iso)}).`;
  if (dia.iso === dataAtual) return `${dia.rotulo} é hoje (${formatar_data_iso_br(dia.iso)}).`;
  return null;
}

export function prefixar_nota_dia_semana(
  resposta: string,
  mensagem: string,
  dataAtual: string,
): string {
  const nota = nota_dia_semana_coincide_hoje_ontem(mensagem, dataAtual);
  if (!nota || resposta.startsWith(nota)) return resposta;
  return `${nota} ${resposta}`;
}

export function parsear_data_relativa_ou_br(texto: string, dataAtual: string): string | null {
  const lower = normalizar_sem_acento(texto);
  if (/\banteontem\b/.test(lower)) return somar_dias_iso_local(dataAtual, -2);
  if (/\bontem\b/.test(lower)) return somar_dias_iso_local(dataAtual, -1);
  if (/\bhoje\b/.test(lower)) return dataAtual;
  if (/\bamanha\b/.test(lower)) return somar_dias_iso_local(dataAtual, 1);
  const dia = extrair_dia_da_semana(texto, dataAtual);
  if (dia) return dia.iso;
  return parsear_data_br(texto, dataAtual);
}

/** Intervalo amplo para "todos os lançamentos" (sem amarrar no mês atual). */
export function periodo_historico_completo(dataAtual: string): { de: string; ate: string } {
  return { de: "2000-01-01", ate: dataAtual };
}

const MESES_NOME =
  /\b(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/i;

/**
 * A mensagem cita um recorte temporal. Sem isso, o código não inventa "mês atual"
 * em pergunta de pessoa/Pix.
 */
export function mensagem_cita_periodo(texto: string, dataAtual: string): boolean {
  if (periodo_relativo_da_mensagem(texto, dataAtual)) return true;
  const t = texto.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{M}/gu, "");
  if (MESES_NOME.test(texto)) return true;
  if (/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(t)) return true;
  if (/\b(semana|ano|mes)\b/.test(t)) return true;
  return false;
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
