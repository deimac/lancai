/**
 * Heurística sobre o `tipo` opaco da Fonte (ex.: Pluggy subtype/type).
 * Cartão de crédito vira cartão local; o restante vira conta.
 */
export function recurso_externo_eh_cartao(tipo: string): boolean {
  const normalizado = tipo.trim().toUpperCase();
  return (
    normalizado.includes("CREDIT_CARD") ||
    normalizado === "CREDIT" ||
    normalizado.includes("CARTAO") ||
    normalizado.includes("CARTÃO")
  );
}
