import { describe, expect, it } from "vitest";
import { interpretar_correcao_rapida } from "../interpretar-correcao-rapida";

describe("interpretar_correcao_rapida", () => {
  it("cancela por código sem IA", () => {
    expect(interpretar_correcao_rapida("cancela o #a7e0df71", "2026-08-03")).toEqual({
      intencao: "CORRIGIR_MOVIMENTO",
      referencia: { codigo: "a7e0df71", descricao: null, data_movimento: null },
      campos_alterados: { status: "cancelado", confirmado: false },
    });
  });

  it("não trata o código como descrição", () => {
    const r = interpretar_correcao_rapida("cancela o #bbbbbbbb", "2026-08-03");
    expect(r?.intencao).toBe("CORRIGIR_MOVIMENTO");
    if (r?.intencao !== "CORRIGIR_MOVIMENTO") return;
    expect(r.referencia.descricao).toBeNull();
    expect(r.referencia.codigo).toBe("bbbbbbbb");
  });

  it("cancela por descrição + hoje", () => {
    expect(
      interpretar_correcao_rapida("apague o lancamento de farmacia de hoje", "2026-08-03"),
    ).toMatchObject({
      intencao: "CORRIGIR_MOVIMENTO",
      referencia: { descricao: "farmacia", data_movimento: "2026-08-03" },
      campos_alterados: { status: "cancelado", confirmado: false },
    });
  });

  it("não intercepta correções de valor", () => {
    expect(interpretar_correcao_rapida("corrige o almoço para 20", "2026-08-03")).toBeNull();
  });
});
