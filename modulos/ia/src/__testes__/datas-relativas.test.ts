import { describe, expect, it } from "vitest";
import {
  parsear_data_apos_para,
  parsear_data_br,
  parsear_data_relativa_ou_br,
} from "../datas-relativas";

describe("parsear_data_br", () => {
  it("lê DD/MM/AAAA e DD/MM com o ano de hoje", () => {
    expect(parsear_data_br("15/08/2026", "2026-08-23")).toBe("2026-08-15");
    expect(parsear_data_br("para 15/08", "2026-08-23")).toBe("2026-08-15");
  });

  it("corrige ano com zero extra (20026 → 2026)", () => {
    expect(parsear_data_br("15/08/20026", "2026-08-23")).toBe("2026-08-15");
  });

  it("aceita ISO e ano com 2 dígitos", () => {
    expect(parsear_data_br("2026-08-15", "2026-01-01")).toBe("2026-08-15");
    expect(parsear_data_br("15/08/26", "2026-08-23")).toBe("2026-08-15");
  });
});

describe("parsear_data_apos_para", () => {
  it("pega a data depois de para, não um dia relativo no meio da frase", () => {
    expect(
      parsear_data_apos_para(
        "alterar data de lançamento do cartão Revolut para 15/08/2026",
        "2026-08-23",
      ),
    ).toBe("2026-08-15");
  });

  it("aceita hoje e ontem depois de para", () => {
    expect(parsear_data_apos_para("muda a data para hoje", "2026-08-23")).toBe("2026-08-23");
    expect(parsear_data_apos_para("muda a data para ontem", "2026-08-23")).toBe("2026-08-22");
    expect(parsear_data_relativa_ou_br("amanhã", "2026-08-23")).toBe("2026-08-24");
    expect(parsear_data_relativa_ou_br("amanha", "2026-08-23")).toBe("2026-08-24");
  });
});
