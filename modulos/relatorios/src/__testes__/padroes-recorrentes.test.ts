import { describe, expect, it } from "vitest";
import { detectar_padroes_recorrentes } from "../padroes-recorrentes";

describe("detectar_padroes_recorrentes", () => {
  it("reconhece a mesma assinatura em dois meses e ignora parcelamento", () => {
    const padroes = detectar_padroes_recorrentes([
      {
        descricao: "Netflix",
        valor: "55.90",
        dataMovimento: "2026-07-10",
        tipo: "despesa",
        cartaoId: null,
        contaId: "conta",
        parcelaTotal: null,
        parcelaCompraEm: null,
        categoriaId: "cat",
      },
      {
        descricao: "NETFLIX",
        valor: "55.90",
        dataMovimento: "2026-08-10",
        tipo: "despesa",
        cartaoId: null,
        contaId: "conta",
        parcelaTotal: null,
        parcelaCompraEm: null,
        categoriaId: "cat",
      },
      {
        descricao: "LATAM",
        valor: "400.00",
        dataMovimento: "2026-08-10",
        tipo: "despesa",
        cartaoId: "cartao",
        parcelaTotal: 3,
        parcelaCompraEm: "2026-06-01",
        categoriaId: "cat",
      },
    ]);
    expect(padroes).toHaveLength(1);
    expect(padroes[0]?.descricao).toBe("Netflix");
    expect(padroes[0]?.valor).toBe(55.9);
  });

  it("não trata compra única como recorrente", () => {
    expect(
      detectar_padroes_recorrentes([
        {
          descricao: "Uber",
          valor: "32.00",
          dataMovimento: "2026-08-10",
          tipo: "despesa",
          cartaoId: null,
          parcelaTotal: null,
          parcelaCompraEm: null,
          categoriaId: "cat",
        },
      ]),
    ).toEqual([]);
  });
});
