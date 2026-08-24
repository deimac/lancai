import { describe, expect, it } from "vitest";
import {
  data_do_ultimo_dia_da_semana,
  extrair_dia_da_semana,
  parsear_data_apos_para,
  parsear_data_br,
  parsear_data_relativa_ou_br,
  periodo_relativo_da_mensagem,
  prefixar_nota_dia_semana,
  resolver_periodo_spec,
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

describe("resolver_periodo_spec", () => {
  it("mes_atual e mes_passado viram intervalo ISO", () => {
    expect(resolver_periodo_spec({ tipo: "mes_atual" }, "2026-08-24")).toEqual({
      de: "2026-08-01",
      ate: "2026-08-31",
    });
    expect(resolver_periodo_spec({ tipo: "mes_passado" }, "2026-08-24")).toEqual({
      de: "2026-07-01",
      ate: "2026-07-31",
    });
  });

  it("janeiro volta para dezembro do ano anterior", () => {
    expect(resolver_periodo_spec({ tipo: "mes_passado" }, "2026-01-10")).toEqual({
      de: "2025-12-01",
      ate: "2025-12-31",
    });
  });

  it("personalizado com de/ate prevalece", () => {
    expect(
      resolver_periodo_spec(
        { tipo: "personalizado", de: "2026-08-01", ate: "2026-08-10" },
        "2026-08-24",
      ),
    ).toEqual({ de: "2026-08-01", ate: "2026-08-10" });
  });
});

describe("dia da semana relativo", () => {
  it("na segunda, domingo é ontem e sábado é anteontem", () => {
    expect(data_do_ultimo_dia_da_semana("2026-08-24", 0)).toBe("2026-08-23");
    expect(data_do_ultimo_dia_da_semana("2026-08-24", 6)).toBe("2026-08-22");
    expect(extrair_dia_da_semana("e domingo?", "2026-08-24")).toMatchObject({
      iso: "2026-08-23",
      chave: "domingo",
    });
    expect(extrair_dia_da_semana("e sábado?", "2026-08-24")?.iso).toBe("2026-08-22");
  });

  it("no próprio domingo, domingo é hoje", () => {
    expect(extrair_dia_da_semana("e domingo?", "2026-08-23")?.iso).toBe("2026-08-23");
  });

  it("não trata segunda parcela como dia da semana", () => {
    expect(extrair_dia_da_semana("segunda parcela do cartão", "2026-08-24")).toBeNull();
  });

  it("explica quando domingo foi ontem", () => {
    expect(prefixar_nota_dia_semana("Você gastou R$ 10.", "e domingo?", "2026-08-24")).toBe(
      "Domingo foi ontem (23/08/2026). Você gastou R$ 10.",
    );
    expect(periodo_relativo_da_mensagem("e mês passado?", "2026-08-24")).toMatchObject({
      origem: "mes_passado",
      de: "2026-07-01",
      ate: "2026-07-31",
    });
  });
});
