/**
 * Total da compra para exibição (chat/extrato). Prefere o valor institucional;
 * senão estima valor da parcela × quantidade (diferenças de centavos ok).
 */
export function total_compra_parcela(entrada: {
  valorParcela: number;
  parcelaTotal: number | null | undefined;
  parcelaCompraValor: number | string | null | undefined;
}): number | null {
  const total = entrada.parcelaTotal;
  if (total == null || total < 2) return null;

  if (entrada.parcelaCompraValor != null && entrada.parcelaCompraValor !== "") {
    const n =
      typeof entrada.parcelaCompraValor === "number"
        ? entrada.parcelaCompraValor
        : Number.parseFloat(entrada.parcelaCompraValor);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100;
  }

  if (!Number.isFinite(entrada.valorParcela) || entrada.valorParcela <= 0) return null;
  return Math.round(entrada.valorParcela * total * 100) / 100;
}
