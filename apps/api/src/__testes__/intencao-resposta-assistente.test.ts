import { describe, expect, it } from "vitest";
import { intencaoParaRespostaChat } from "../servicos/intencao-resposta-assistente";

describe("intencaoParaRespostaChat", () => {
  it("consulta (e ausência de diagnóstico) devolve CONSULTAR_VISAO", () => {
    expect(intencaoParaRespostaChat({ op: "query" }).intencao).toBe("CONSULTAR_VISAO");
    expect(intencaoParaRespostaChat().intencao).toBe("CONSULTAR_VISAO");
  });

  it("create pendente não marca confirmado, para o cockpit não atualizar cedo", () => {
    const intencao = intencaoParaRespostaChat({ op: "create", confirm: true });
    expect(intencao).toMatchObject({ intencao: "REGISTRAR_MOVIMENTO", confirmado: false });
  });

  it("delete vira CORRIGIR_MOVIMENTO cancelado", () => {
    expect(intencaoParaRespostaChat({ op: "delete" })).toMatchObject({
      intencao: "CORRIGIR_MOVIMENTO",
      campos_alterados: { status: "cancelado", confirmado: true },
    });
  });
});
