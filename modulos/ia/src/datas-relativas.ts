/** Soma dias em uma data ISO (YYYY-MM-DD) sem efeito de fuso. */
export function somar_dias_iso_local(dataISO: string, dias: number): string {
  const data = new Date(`${dataISO}T12:00:00.000Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}
