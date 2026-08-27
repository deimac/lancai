/**
 * Helpers de dinheiro. As colunas `numeric` do Postgres chegam como string via Drizzle
 * (para não perder precisão). Todo cálculo financeiro deve passar por aqui, nunca
 * fazer aritmética direta com float sem arredondar.
 */

export function paraNumero(valor: string | number): number {
  const numero = typeof valor === "number" ? valor : Number.parseFloat(valor);
  if (Number.isNaN(numero)) {
    throw new Error(`Valor monetário inválido: ${valor}`);
  }
  return arredondar(numero);
}

export function paraColuna(valor: number): string {
  return arredondar(valor).toFixed(2);
}

export function arredondar(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

export function somar(...valores: Array<string | number>): number {
  let total = 0;
  for (const valor of valores) {
    total += paraNumero(valor);
  }
  return arredondar(total);
}

export function subtrair(minuendo: string | number, subtraendo: string | number): number {
  return arredondar(paraNumero(minuendo) - paraNumero(subtraendo));
}

/** Distância em centavos (7,95 vs 7,96 → 1). */
export function diferenca_em_centavos(a: string | number, b: string | number): number {
  return Math.round(Math.abs(paraNumero(a) - paraNumero(b)) * 100);
}

export function formatarMoeda(valor: string | number): string {
  return paraNumero(valor).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/**
 * Divide um valor em N parcelas iguais, ajustando a última parcela
 * para absorver a diferença de arredondamento (regra padrão de sistemas financeiros).
 */
export function dividirEmParcelas(valorTotal: number, quantidadeParcelas: number): number[] {
  if (quantidadeParcelas < 1) {
    throw new Error("quantidadeParcelas deve ser maior ou igual a 1");
  }

  const valorParcela = arredondar(valorTotal / quantidadeParcelas);
  const parcelas = new Array(quantidadeParcelas).fill(valorParcela);

  const somaParcelas = arredondar(valorParcela * quantidadeParcelas);
  const diferenca = arredondar(valorTotal - somaParcelas);

  if (diferenca !== 0) {
    parcelas[parcelas.length - 1] = arredondar(parcelas[parcelas.length - 1] + diferenca);
  }

  return parcelas;
}
