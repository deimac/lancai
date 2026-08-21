import { describe, expect, it } from "vitest";
import {
  agrupar_series_parcelamento,
  chave_serie_parcelamento,
  eh_movimento_parcelado,
  irmas_da_serie,
  normalizar_descricao_parcela,
} from "../serie-parcelamento";

function parcela(parcial: {
  id: string;
  descricao?: string;
  parcelaNumero: number;
  parcelaTotal?: number;
  cartaoId?: string;
  parcelaCompraEm?: string;
  dataMovimento?: string;
  status?: string;
}) {
  return {
    id: parcial.id,
    descricao: parcial.descricao ?? "LATAM",
    valor: "100.00",
    dataMovimento: parcial.dataMovimento ?? "2026-08-10",
    cartaoId: parcial.cartaoId ?? "cartao",
    parcelaNumero: parcial.parcelaNumero,
    parcelaTotal: parcial.parcelaTotal ?? 3,
    parcelaCompraEm: parcial.parcelaCompraEm ?? "2026-06-01",
    status: parcial.status,
  };
}

describe("série de parcelamento OF", () => {
  it("normaliza descrição ignorando acento e caixa", () => {
    expect(normalizar_descricao_parcela("  Latâm  ")).toBe("latam");
  });

  it("só trata movimento com cartão, total ≥ 2 e data da compra", () => {
    expect(eh_movimento_parcelado(parcela({ id: "a", parcelaNumero: 1 }))).toBe(true);
    expect(
      eh_movimento_parcelado({
        cartaoId: "c",
        parcelaTotal: 1,
        parcelaCompraEm: "2026-06-01",
      }),
    ).toBe(false);
  });

  it("agrupa irmãs da mesma compra e separa outra descrição", () => {
    const grupos = agrupar_series_parcelamento([
      parcela({ id: "1", parcelaNumero: 1 }),
      parcela({ id: "2", parcelaNumero: 2, dataMovimento: "2026-09-10" }),
      parcela({ id: "x", parcelaNumero: 1, descricao: "UBER" }),
    ]);
    expect(grupos).toHaveLength(2);
    const latam = grupos.find((g) => g[0]?.descricao === "LATAM");
    expect(latam?.map((p) => p.id)).toEqual(["1", "2"]);
  });

  it("irmas_da_serie prefere a mesma descrição dentro da compra", () => {
    const ancora = parcela({ id: "1", parcelaNumero: 1 });
    const irmas = irmas_da_serie(ancora, [
      ancora,
      parcela({ id: "2", parcelaNumero: 2 }),
      parcela({ id: "x", parcelaNumero: 1, descricao: "OUTRA" }),
    ]);
    expect(irmas.map((p) => p.id)).toEqual(["1", "2"]);
  });

  it("chave inclui cartão, compra e total", () => {
    expect(chave_serie_parcelamento(parcela({ id: "1", parcelaNumero: 1 }))).toBe(
      "cartao|2026-06-01|3|latam",
    );
  });
});
