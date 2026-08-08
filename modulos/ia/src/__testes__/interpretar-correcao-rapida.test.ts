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
      referencia: { descricao: "Farmacia", data_movimento: "2026-08-03" },
      campos_alterados: { status: "cancelado", confirmado: false },
    });
  });

  it("corrige valor sem IA", () => {
    expect(interpretar_correcao_rapida("corrige o almoço para 20", "2026-08-03")).toEqual({
      intencao: "CORRIGIR_MOVIMENTO",
      referencia: { descricao: "Almoço", data_movimento: null, codigo: null },
      campos_alterados: { valor: 20 },
    });
  });

  it("corrige valor com data e reais", () => {
    expect(
      interpretar_correcao_rapida("corrige o ifood de ontem para 45,90 reais", "2026-08-03"),
    ).toMatchObject({
      intencao: "CORRIGIR_MOVIMENTO",
      referencia: { descricao: "Ifood", data_movimento: "2026-08-02" },
      campos_alterados: { valor: 45.9 },
    });
  });

  it("corrige descrição explícita sem IA", () => {
    expect(
      interpretar_correcao_rapida("muda a descrição do uber para Uber Trip", "2026-08-03"),
    ).toMatchObject({
      intencao: "CORRIGIR_MOVIMENTO",
      referencia: { descricao: "Uber" },
      campos_alterados: { descricao: "Uber Trip" },
    });
  });

  it("renomeia lançamento com 'para' textual", () => {
    expect(interpretar_correcao_rapida("muda o almoço para jantar", "2026-08-03")).toMatchObject({
      intencao: "CORRIGIR_MOVIMENTO",
      referencia: { descricao: "Almoço" },
      campos_alterados: { descricao: "Jantar" },
    });
  });

  it("exclui conta sem tratar como lançamento", () => {
    expect(interpretar_correcao_rapida("excluir conta nubank", "2026-08-03")).toEqual({
      intencao: "CORRIGIR_CONTA",
      conta_nome: "nubank",
      campos_alterados: { ativo: false, confirmado: false },
    });
  });

  it("exclui cartão sem tratar como lançamento", () => {
    expect(interpretar_correcao_rapida("apagar o cartão Azul Itaú", "2026-08-03")).toEqual({
      intencao: "CORRIGIR_CARTAO",
      cartao_nome: "Azul Itaú",
      campos_alterados: { ativo: false, confirmado: false },
    });
  });
});
