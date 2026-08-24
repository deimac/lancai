import { describe, expect, it } from "vitest";
import { formatarDataHoraBrasil, formatarHoraBrasil, formatarQuandoFato, hojeISO } from "../datas";

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
});
