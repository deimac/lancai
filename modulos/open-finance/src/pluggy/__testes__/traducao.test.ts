import { describe, expect, it } from "vitest";
import { somar_meses, traduzir_transacao } from "../traducao";
import type { TransacaoPluggy } from "../tipos";

function tx(sobrepor: Partial<TransacaoPluggy> = {}): TransacaoPluggy {
  return {
    id: "tx-1",
    accountId: "acc-1",
    amount: -518.53,
    date: "2026-07-13T12:00:00.000Z",
    type: "DEBIT",
    status: "PENDING",
    descriptionRaw: "E AGENCIAS*711289",
    creditCardMetadata: {
      installmentNumber: 4,
      totalInstallments: 10,
      purchaseDate: "2026-07-13T12:00:00.000Z",
      billForecastDate: "2026-10",
    },
    ...sobrepor,
  };
}

describe("traduzir_transacao", () => {
  it("usa billForecastDate como ocorridoEm em parcela PENDING", () => {
    const mov = traduzir_transacao(tx());
    expect(mov.ocorridoEm).toBe("2026-10-01");
    expect(mov.statusFonte).toBe("pendente");
    expect(mov.parcelamento).toEqual({
      numero: 4,
      total: 10,
      valorTotal: undefined,
      compraEm: "2026-07-13",
    });
  });

  it("também usa billForecastDate em parcela POSTED quando o date é de outro mês", () => {
    const mov = traduzir_transacao(
      tx({
        status: "POSTED",
        date: "2026-05-14T00:00:00.000Z",
        creditCardMetadata: {
          installmentNumber: 1,
          totalInstallments: 4,
          purchaseDate: "2026-05-14T00:00:00.000Z",
          billForecastDate: "2026-06",
        },
      }),
    );
    expect(mov.ocorridoEm).toBe("2026-06-01");
  });

  it("mantém o dia do provedor quando já cai no mês da fatura", () => {
    const mov = traduzir_transacao(
      tx({
        status: "POSTED",
        date: "2026-07-12T00:00:00.000Z",
        creditCardMetadata: {
          installmentNumber: 6,
          totalInstallments: 11,
          purchaseDate: "2026-01-22T00:00:00.000Z",
          billForecastDate: "2026-07",
        },
      }),
    );
    expect(mov.ocorridoEm).toBe("2026-07-12");
  });

  it("guarda a hora da Pluggy quando o dia do movimento é o mesmo do date", () => {
    const mov = traduzir_transacao(
      tx({
        status: "POSTED",
        date: "2026-08-20T18:00:00.000Z",
        creditCardMetadata: null,
      }),
    );
    expect(mov.ocorridoEm).toBe("2026-08-20");
    expect(mov.ocorridoEmInstante).toBe("2026-08-20T18:00:00.000Z");
  });

  it("não herda a hora da compra quando a competência cai em outro mês", () => {
    const mov = traduzir_transacao(tx());
    expect(mov.ocorridoEm).toBe("2026-10-01");
    expect(mov.ocorridoEmInstante).toBeUndefined();
  });

  it("sem forecast, espalha PENDING por compra + (N-1) meses", () => {
    const mov = traduzir_transacao(
      tx({
        creditCardMetadata: {
          installmentNumber: 3,
          totalInstallments: 10,
          purchaseDate: "2026-07-13T12:00:00.000Z",
        },
      }),
    );
    expect(mov.ocorridoEm).toBe("2026-09-13");
  });
});

describe("somar_meses", () => {
  it("avança meses e respeita o último dia do mês", () => {
    expect(somar_meses("2026-01-31", 1)).toBe("2026-02-28");
    expect(somar_meses("2026-07-13", 2)).toBe("2026-09-13");
  });
});
