export function formatar_moeda(valor: number): string {
  const seguro = Number.isFinite(valor) ? valor : 0;
  return seguro.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatar_data_curta(valor: string): string {
  const [ano, mes, dia] = valor.split("-");
  if (!ano || !mes || !dia) return valor;
  return `${dia}/${mes}`;
}

export function formatar_mes(yyyyMm: string): string {
  const [ano, mes] = yyyyMm.split("-");
  if (!ano || !mes) return yyyyMm;
  const data = new Date(Number(ano), Number(mes) - 1, 1);
  return data.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

export function formatar_intervalo_ciclo(inicio: string, fim: string): string {
  return `${formatar_data_curta(inicio)} → ${formatar_data_curta(fim)}`;
}

/** `01/08–31/08` — calendário civil do mês. */
export function formatar_calendario_mes(yyyyMm: string): string {
  const [ano, mes] = yyyyMm.split("-");
  if (!ano || !mes) return yyyyMm;
  const ultimo = new Date(Number(ano), Number(mes), 0).getDate();
  return `01/${mes}–${String(ultimo).padStart(2, "0")}/${mes}`;
}

export function nome_mes_curto(yyyyMm: string): string {
  const cheio = formatar_mes(yyyyMm);
  return cheio.split(" ")[0] ?? yyyyMm;
}

export function rotulo_faturas_recorte(mesAtual: boolean): string {
  return mesAtual ? "Compras neste ciclo" : "Compras do ciclo";
}

export function rotulo_legenda_periodos(yyyyMm: string): string {
  return `Contas: ${formatar_calendario_mes(yyyyMm)} · Cartões: ciclo de cada fatura`;
}
