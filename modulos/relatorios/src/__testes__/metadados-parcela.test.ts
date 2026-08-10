import { describe, expect, it } from "vitest";
import { total_compra_parcela } from "../metadados-parcela";

describe("total_compra_parcela", () => {
  it("usa o total institucional quando existe", () => {
    expect(
      total_compra_parcela({
        valorParcela: 434.38,
        parcelaTotal: 10,
        parcelaCompraValor: "4343.53",
      }),
    ).toBe(4343.53);
  });

  it("estima valor × N quando o total institucional falta", () => {
    expect(
      total_compra_parcela({
        valorParcela: 434.38,
        parcelaTotal: 10,
        parcelaCompraValor: null,
      }),
    ).toBe(4343.8);
  });

  it("retorna null sem parcelamento", () => {
    expect(
      total_compra_parcela({
        valorParcela: 100,
        parcelaTotal: 1,
        parcelaCompraValor: null,
      }),
    ).toBeNull();
    expect(
      total_compra_parcela({
        valorParcela: 100,
        parcelaTotal: null,
        parcelaCompraValor: "1000",
      }),
    ).toBeNull();
  });
});
