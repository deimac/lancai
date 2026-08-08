import { describe, expect, it } from "vitest";
import { interpretar_enriquecimento_rapido } from "../interpretar-enriquecimento-rapido";

describe("interpretar_enriquecimento_rapido", () => {
  it("esconde por descrição nos relatórios", () => {
    expect(
      interpretar_enriquecimento_rapido("não considera iFood nos relatórios", "2026-08-08"),
    ).toEqual({
      intencao: "CORRIGIR_MOVIMENTO",
      referencia: { codigo: null, descricao: "IFood", data_movimento: null },
      campos_alterados: { ignorado_em_relatorio: true },
    });
  });

  it("aceita a frase da recusa com 'esse'", () => {
    expect(
      interpretar_enriquecimento_rapido("não considera esse nos relatórios", "2026-08-08"),
    ).toEqual({
      intencao: "CORRIGIR_MOVIMENTO",
      referencia: { codigo: null, descricao: null, data_movimento: null },
      campos_alterados: { ignorado_em_relatorio: true },
    });
  });

  it("esconde por código", () => {
    const r = interpretar_enriquecimento_rapido(
      "esconde o #a7e0df71 dos totais",
      "2026-08-08",
    );
    expect(r).toMatchObject({
      intencao: "CORRIGIR_MOVIMENTO",
      referencia: { codigo: "a7e0df71" },
      campos_alterados: { ignorado_em_relatorio: true },
    });
  });

  it("marca tag no lançamento", () => {
    expect(interpretar_enriquecimento_rapido("tag projeto Itália no ifood", "2026-08-08")).toEqual({
      intencao: "CORRIGIR_MOVIMENTO",
      referencia: { codigo: null, descricao: "Ifood", data_movimento: null },
      campos_alterados: { tags: ["projeto Itália"] },
    });
  });

  it("não intercepta cancelamento nem correção de valor", () => {
    expect(interpretar_enriquecimento_rapido("apague o ifood", "2026-08-08")).toBeNull();
    expect(interpretar_enriquecimento_rapido("corrige o almoço para 20", "2026-08-08")).toBeNull();
  });
});
