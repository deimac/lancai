import { describe, expect, it } from "vitest";
import { traduzir_transacao } from "../traducao";
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

  it("mantém o date da instituição quando a parcela já está POSTED", () => {
    const mov = traduzir_transacao(
      tx({
        status: "POSTED",
        date: "2026-10-05T00:00:00.000Z",
        creditCardMetadata: {
          installmentNumber: 4,
          totalInstallments: 10,
          purchaseDate: "2026-07-13T12:00:00.000Z",
          billForecastDate: "2026-10",
        },
      }),
    );
    expect(mov.ocorridoEm).toBe("2026-10-05");
  });
});
