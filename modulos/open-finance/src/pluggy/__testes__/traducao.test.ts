import { describe, expect, it } from "vitest";
import { somar_meses, traduzir_lote_transacoes, traduzir_transacao } from "../traducao";
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

  it("compra internacional usa o valor em real da conta, não o amount em dólar", () => {
    const mov = traduzir_transacao(
      tx({
        amount: -39.99,
        currencyCode: "USD",
        amountInAccountCurrency: -224.34,
        descriptionRaw: "FLIGHTCONNECTIONSENSCHEDENL",
        creditCardMetadata: null,
      }),
    );
    expect(mov.valor).toBe(224.34);
  });

  it("compra nacional continua usando amount quando não há conversão", () => {
    const mov = traduzir_transacao(
      tx({
        amount: -65.83,
        currencyCode: "BRL",
        amountInAccountCurrency: null,
        creditCardMetadata: null,
      }),
    );
    expect(mov.valor).toBe(65.83);
  });

  it("hotel 1/10 POSTED com billForecastDate julho fica em julho; compraEm é 01/06", () => {
    const mov = traduzir_transacao(
      tx({
        id: "9d252479",
        status: "POSTED",
        date: "2026-06-01T22:56:00.000Z",
        amount: -311.4,
        descriptionRaw: "HOTELDOBARUERIBR  01/10",
        creditCardMetadata: {
          installmentNumber: 1,
          totalInstallments: 10,
          purchaseDate: "2026-06-01T22:56:00.000Z",
          billForecastDate: "2026-07",
        },
      }),
    );
    expect(mov.ocorridoEm).toBe("2026-07-01");
    expect(mov.parcelamento?.compraEm).toBe("2026-06-01");
    expect(mov.descricaoFonte).toBe("HOTELDOBARUERIBR  01/10");
  });

  it("purchaseDate UTC que vira o dia no Brasil permanece 01/06", () => {
    const mov = traduzir_transacao(
      tx({
        status: "PENDING",
        date: "2026-09-08T00:00:00.000Z",
        creditCardMetadata: {
          installmentNumber: 3,
          totalInstallments: 10,
          purchaseDate: "2026-06-02T01:56:00.000Z",
          billForecastDate: "2026-09",
        },
      }),
    );
    expect(mov.parcelamento?.compraEm).toBe("2026-06-01");
    expect(mov.ocorridoEm).toBe("2026-09-08");
  });
});

describe("traduzir_lote_transacoes", () => {
  it("compra internacional com conversão entra pelo valor em real", () => {
    const lote = traduzir_lote_transacoes([
      tx({
        id: "usd",
        amount: -39.99,
        currencyCode: "USD",
        amountInAccountCurrency: -224.34,
        descriptionRaw: "FLIGHTCONNECTIONSENSCHEDENL",
        creditCardMetadata: null,
      }),
    ]);
    expect(lote).toHaveLength(1);
    expect(lote[0]?.valor).toBe(224.34);
  });

  it("1/10 e 2/10 com date 01/06 caem em julho e agosto, não as duas em junho", () => {
    const lote = traduzir_lote_transacoes([
      tx({
        id: "p1",
        status: "POSTED",
        date: "2026-06-01T22:56:00.000Z",
        amount: -311.4,
        descriptionRaw: "HOTELDOBARUERIBR  01/10",
        creditCardMetadata: {
          installmentNumber: 1,
          totalInstallments: 10,
          purchaseDate: "2026-06-01T22:56:00.000Z",
          billForecastDate: "2026-07",
        },
      }),
      tx({
        id: "p2",
        status: "POSTED",
        date: "2026-06-01T22:56:00.000Z",
        amount: -311.4,
        descriptionRaw: "HOTELDOBARUERIBR  02/10",
        creditCardMetadata: {
          installmentNumber: 2,
          totalInstallments: 10,
          purchaseDate: "2026-06-01T22:56:00.000Z",
        },
      }),
    ]);
    const porNumero = new Map(lote.map((m) => [m.parcelamento?.numero, m.ocorridoEm]));
    expect(porNumero.get(1)).toBe("2026-07-01");
    expect(porNumero.get(2)?.startsWith("2026-08")).toBe(true);
  });

  it("compra nacional sem amountInAccountCurrency continua usando amount", () => {
    const lote = traduzir_lote_transacoes([
      tx({
        id: "brl",
        amount: -65.83,
        currencyCode: "BRL",
        amountInAccountCurrency: null,
        creditCardMetadata: null,
      }),
    ]);
    expect(lote).toHaveLength(1);
    expect(lote[0]?.valor).toBe(65.83);
  });

  it("USD sem conversão não vira Fato — espera o amountInAccountCurrency", () => {
    const lote = traduzir_lote_transacoes([
      tx({
        id: "usd",
        amount: -39.99,
        currencyCode: "USD",
        amountInAccountCurrency: null,
        descriptionRaw: "FLIGHTCONNECTIONSENSCHEDENL",
        creditCardMetadata: null,
      }),
      tx({
        id: "brl",
        amount: -65.83,
        currencyCode: "BRL",
        creditCardMetadata: null,
      }),
    ]);
    expect(lote.map((m) => m.idExterno)).toEqual(["brl"]);
  });

  it("IOF ~19% no mesmo dia omite a compra ainda em moeda original", () => {
    const lote = traduzir_lote_transacoes([
      tx({
        id: "compra",
        amount: -39.99,
        date: "2026-08-06T00:00:00.000Z",
        descriptionRaw: "FLIGHTCONNECTIONSENSCHEDENL",
        creditCardMetadata: null,
      }),
      tx({
        id: "iof",
        amount: -7.57,
        date: "2026-08-06T00:00:00.000Z",
        descriptionRaw: "IOF INTERNACIONAL - FLIGHTCONNECTIONSENSCHEDENL",
        creditCardMetadata: null,
      }),
    ]);
    expect(lote.map((m) => m.idExterno)).toEqual(["iof"]);
    expect(lote[0]?.valor).toBe(7.57);
    expect(lote[0]?.statusFonte).not.toBe("removido");
  });

  it("IOF ~3,5% some na compra — o banco mostra uma linha só", () => {
    const lote = traduzir_lote_transacoes([
      tx({
        id: "compra",
        amount: -224.34,
        date: "2026-08-06T00:00:00.000Z",
        descriptionRaw: "FLIGHTCONNECTIONSENSCHEDENL",
        creditCardMetadata: null,
      }),
      tx({
        id: "iof",
        amount: -7.57,
        date: "2026-08-06T00:00:00.000Z",
        descriptionRaw: "IOF INTERNACIONAL - FLIGHTCONNECTIONSENSCHEDENL",
        creditCardMetadata: null,
      }),
    ]);
    const compra = lote.find((m) => m.idExterno === "compra");
    const iof = lote.find((m) => m.idExterno === "iof");
    expect(compra?.valor).toBe(231.91);
    expect(iof?.statusFonte).toBe("removido");
    expect(iof?.valor).toBe(7.57);
  });

  it("IOF genérico do Nubank casa pela alíquota mesmo em dia vizinho", () => {
    const lote = traduzir_lote_transacoes([
      tx({
        id: "wizz",
        amount: -2434.77,
        amountInAccountCurrency: 2434.77,
        currencyCode: "USD",
        date: "2026-07-29T16:43:55.001Z",
        descriptionRaw: "Wizz Airiqk3sa",
        creditCardMetadata: { billForecastDate: "2026-08" },
      }),
      tx({
        id: "iof",
        amount: -85.22,
        date: "2026-07-30T07:40:56.865Z",
        descriptionRaw: "IOF de compra internacional",
        creditCardMetadata: { feeTypeAdditionalInfo: "IOF_COMPRA_INTERNACIONAL" },
      }),
    ]);
    expect(lote.find((m) => m.idExterno === "wizz")?.valor).toBe(2519.99);
    expect(lote.find((m) => m.idExterno === "iof")?.statusFonte).toBe("removido");
  });

  it("USD com amountInAccountCurrency some o IOF nomeado no real", () => {
    const lote = traduzir_lote_transacoes([
      tx({
        id: "github",
        amount: -10,
        amountInAccountCurrency: -55,
        currencyCode: "USD",
        date: "2026-02-11T00:00:00.000Z",
        descriptionRaw: "GITHUB, INC.GITHUB.COMUS",
        creditCardMetadata: null,
      }),
      tx({
        id: "iof",
        amount: -1.92,
        date: "2026-02-11T00:00:00.000Z",
        descriptionRaw: "IOF INTERNACIONAL - GITHUB, INC.GITHUB.COMUS",
        creditCardMetadata: null,
      }),
    ]);
    expect(lote.find((m) => m.idExterno === "github")?.valor).toBe(56.92);
    expect(lote.find((m) => m.idExterno === "iof")?.statusFonte).toBe("removido");
  });

  it("não mistura IOF de atraso com compra", () => {
    const lote = traduzir_lote_transacoes([
      tx({
        id: "compra",
        amount: -328.86,
        date: "2026-06-11T00:00:00.000Z",
        descriptionRaw: "Mercado",
        creditCardMetadata: null,
      }),
      tx({
        id: "atraso",
        amount: -11.51,
        date: "2026-06-11T00:00:00.000Z",
        descriptionRaw: "IOF de atraso",
        creditCardMetadata: null,
      }),
    ]);
    expect(lote.find((m) => m.idExterno === "compra")?.valor).toBe(328.86);
    expect(lote.find((m) => m.idExterno === "atraso")?.statusFonte).not.toBe("removido");
  });

  it("não soma IOF ambíguo quando duas compras batem 3,5% no mesmo dia", () => {
    const lote = traduzir_lote_transacoes([
      tx({
        id: "a",
        amount: -100,
        date: "2026-08-01T00:00:00.000Z",
        descriptionRaw: "Loja A",
        creditCardMetadata: null,
      }),
      tx({
        id: "b",
        amount: -100,
        date: "2026-08-01T00:00:00.000Z",
        descriptionRaw: "Loja B",
        creditCardMetadata: null,
      }),
      tx({
        id: "iof",
        amount: -3.5,
        date: "2026-08-01T00:00:00.000Z",
        descriptionRaw: "IOF de compra internacional",
        creditCardMetadata: null,
      }),
    ]);
    expect(lote.find((m) => m.idExterno === "a")?.valor).toBe(100);
    expect(lote.find((m) => m.idExterno === "b")?.valor).toBe(100);
    expect(lote.find((m) => m.idExterno === "iof")?.statusFonte).not.toBe("removido");
  });
});

describe("somar_meses", () => {
  it("avança meses e respeita o último dia do mês", () => {
    expect(somar_meses("2026-01-31", 1)).toBe("2026-02-28");
    expect(somar_meses("2026-07-13", 2)).toBe("2026-09-13");
  });
});
