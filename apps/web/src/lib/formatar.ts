export function formatar_moeda(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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
