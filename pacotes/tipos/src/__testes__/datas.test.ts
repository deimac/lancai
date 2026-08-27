import { describe, expect, it } from "vitest";
import {
  calcularDataVencimentoFatura,
  competencia_fatura_da_compra,
  data_movimento_parcela,
  datas_civis_proximas,
  deISOParaData,
  dia_civil_iso,
  dia_provedor_iso,
  formatarDataHoraBrasil,
  formatarHoraBrasil,
  formatarQuandoFato,
  garantir_parcelas_subsequentes,
  hojeISO,
  paraDataISO,
} from "../datas";

describe("hojeISO", () => {
  it("usa o dia civil do fuso, não UTC", () => {
    // 2026-08-04 00:30 UTC = ainda 03/08 à noite em São Paulo (-03).
    const noiteNoBrasil = new Date("2026-08-04T00:30:00.000Z");
    expect(hojeISO(noiteNoBrasil, "America/Sao_Paulo")).toBe("2026-08-03");
    expect(hojeISO(noiteNoBrasil, "UTC")).toBe("2026-08-04");
  });
});

describe("formatarDataHoraBrasil", () => {
  it("formata data e hora no fuso de São Paulo", () => {
    expect(formatarDataHoraBrasil(new Date("2026-08-05T17:32:00.000Z"))).toBe("05/08/2026 14:32");
  });
});

describe("formatarHoraBrasil", () => {
  it("mostra HH:mm no fuso de São Paulo", () => {
    expect(formatarHoraBrasil(new Date("2026-08-05T17:32:00.000Z"))).toBe("14:32");
  });

  it("meia-noite UTC (só o dia) aparece como 00:00", () => {
    expect(formatarHoraBrasil("2026-08-20T00:00:00.000Z")).toBe("00:00");
  });
});

describe("formatarQuandoFato", () => {
  it("mostra só o dia da fatura quando não há hora da instituição", () => {
    expect(formatarQuandoFato("2026-07-10")).toBe("10/07/2026");
    expect(formatarQuandoFato("2026-07-10", null)).toBe("10/07/2026");
  });

  it("ignora meia-noite UTC (PDF/OF só com o dia)", () => {
    expect(formatarQuandoFato("2026-07-10", "2026-07-10T00:00:00.000Z")).toBe("10/07/2026");
  });

  it("anexa a hora real da instituição", () => {
    expect(formatarQuandoFato("2026-08-05", new Date("2026-08-05T17:32:00.000Z"))).toBe(
      "05/08/2026 14:32",
    );
  });

  it("não cola hora do Brasil num dia UTC diferente (madrugada)", () => {
    expect(formatarQuandoFato("2026-08-24", "2026-08-24T00:33:38.001Z")).toBe("24/08/2026");
  });
});

describe("competência da fatura (parcela conta no vencimento)", () => {
  it("Azul fecha 30 vence 6: compra 01/06 cai na fatura de julho", () => {
    expect(competencia_fatura_da_compra("2026-06-01", 30, 6)).toBe("2026-07");
    expect(paraDataISO(calcularDataVencimentoFatura(deISOParaData("2026-06-01"), 30, 6))).toBe(
      "2026-07-06",
    );
  });

  it("fecha 20 vence 27: compra 15/07 vence em 27/08", () => {
    expect(paraDataISO(calcularDataVencimentoFatura(deISOParaData("2026-07-15"), 20, 27))).toBe(
      "2026-08-27",
    );
  });

  it("billForecastDate manda no mês da parcela", () => {
    expect(
      data_movimento_parcela({
        numero: 1,
        compraEm: "2026-06-01",
        billForecastDate: "2026-07",
        dateProvedor: "2026-06-01",
      }),
    ).toBe("2026-07-01");
  });

  it("sem forecast, 1ª parcela usa o vencimento e as seguintes avançam o ciclo", () => {
    expect(
      data_movimento_parcela({
        numero: 1,
        compraEm: "2026-06-01",
        fechamento: 30,
        vencimento: 6,
      }),
    ).toBe("2026-07-01");
    expect(
      data_movimento_parcela({
        numero: 2,
        compraEm: "2026-06-01",
        fechamento: 30,
        vencimento: 6,
      }),
    ).toBe("2026-08-01");
  });

  it("na mesma série, número maior não convive no mês da anterior", () => {
    const datas = garantir_parcelas_subsequentes([
      { numero: 1, dataMovimento: "2026-06-01" },
      { numero: 2, dataMovimento: "2026-06-01" },
    ]);
    expect(datas.get(1)).toBe("2026-06-01");
    expect(datas.get(2)).toBe("2026-07-01");
  });

  it("purchaseDate 22:56 UTC permanece 01/06; madrugada UTC segue o calendário do date", () => {
    expect(dia_civil_iso("2026-06-01T22:56:00.000Z")).toBe("2026-06-01");
    expect(dia_civil_iso("2026-06-02T01:56:00.000Z")).toBe("2026-06-01");
    expect(dia_provedor_iso("2026-06-01T22:56:00.000Z")).toBe("2026-06-01");
    expect(dia_provedor_iso("2026-06-02T01:56:00.000Z")).toBe("2026-06-02");
    expect(dia_provedor_iso("2026-08-06T00:00:00.000Z")).toBe("2026-08-06");
    expect(dia_provedor_iso("2026-08-24T00:33:38.001Z")).toBe("2026-08-24");
  });

  it("datas civis vizinhas (fuso) são a mesma compra", () => {
    expect(datas_civis_proximas("2026-06-01", "2026-06-02")).toBe(true);
    expect(datas_civis_proximas("2026-06-01", "2026-06-03")).toBe(false);
  });
});
