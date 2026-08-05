/** Soma dias em uma data ISO (YYYY-MM-DD) sem efeito de fuso. */
export function somar_dias_iso_local(dataISO: string, dias: number): string {
  const data = new Date(`${dataISO}T12:00:00.000Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

/** Primeiro e último dia do mês de `dataISO` (YYYY-MM-DD). */
export function inicio_fim_mes_iso(dataISO: string): { de: string; ate: string } {
  const [ano, mes] = dataISO.split("-").map(Number) as [number, number];
  const inicio = `${ano}-${String(mes).padStart(2, "0")}-01`;
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const fim = `${ano}-${String(mes).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}`;
  return { de: inicio, ate: fim };
}
