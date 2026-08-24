import { describe, expect, it } from "vitest";
import { eh_pedido_fluxo_cruzado } from "../pedido-fluxo-cruzado";

describe("eh_pedido_fluxo_cruzado", () => {
  it("reconhece gasto pessoal na conta da empresa, inclusive no plural", () => {
    expect(
      eh_pedido_fluxo_cruzado("quanto tive de gastos pessoais na conta da empresa esse mes?"),
    ).toBe(true);
    expect(eh_pedido_fluxo_cruzado("quanto gastei de pessoal com dinheiro da empresa?")).toBe(true);
    expect(eh_pedido_fluxo_cruzado("gastos pessoais na conta pj")).toBe(true);
    expect(eh_pedido_fluxo_cruzado("fluxo cruzado")).toBe(true);
    expect(eh_pedido_fluxo_cruzado("aquele uber foi pessoal")).toBe(false);
  });

  it("não trata extrato da empresa ou gasto pessoal sem cruzar contas", () => {
    expect(eh_pedido_fluxo_cruzado("quanto gastei na conta da empresa esse mes?")).toBe(false);
    expect(eh_pedido_fluxo_cruzado("gastos pessoais no nubank")).toBe(false);
    expect(eh_pedido_fluxo_cruzado("quanto tive de entradas na mercado pago?")).toBe(false);
  });
});
