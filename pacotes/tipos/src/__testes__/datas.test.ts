import { describe, expect, it } from "vitest";
import { hojeISO } from "../datas";

describe("hojeISO", () => {
  it("usa o dia civil do fuso, não UTC", () => {
    // 2026-08-04 00:30 UTC = ainda 03/08 à noite em São Paulo (-03).
    const noiteNoBrasil = new Date("2026-08-04T00:30:00.000Z");
    expect(hojeISO(noiteNoBrasil, "America/Sao_Paulo")).toBe("2026-08-03");
    expect(hojeISO(noiteNoBrasil, "UTC")).toBe("2026-08-04");
  });
});
