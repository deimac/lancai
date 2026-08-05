import { describe, expect, it } from "vitest";
import {
  mensagem_parece_resposta_slot,
  ramo_de_intencao_pendente,
  schema_por_ramo,
} from "../ramos-intencao";

describe("ramos-intencao", () => {
  it("mapeia pendência para ramo", () => {
    expect(ramo_de_intencao_pendente("REGISTRAR_MOVIMENTO")).toBe("registrar");
    expect(ramo_de_intencao_pendente("CRIAR_CONTA")).toBe("cadastro");
    expect(ramo_de_intencao_pendente("CRIAR_CARTAO")).toBe("cadastro");
  });

  it("detecta resposta curta de slot", () => {
    expect(mensagem_parece_resposta_slot("30")).toBe(true);
    expect(mensagem_parece_resposta_slot("fechamento 10")).toBe(true);
    expect(mensagem_parece_resposta_slot("sim")).toBe(true);
    expect(
      mensagem_parece_resposta_slot(
        "gastei 45 no ifood ontem no cartao azul itaú com a conta da empresa pessoal",
      ),
    ).toBe(false);
  });

  it("schema por ramo só inclui intenções do ramo", () => {
    const registrar = schema_por_ramo("registrar");
    expect(
      registrar.safeParse({
        intencao_detectada: {
          intencao: "REGISTRAR_MOVIMENTO",
          tipo_movimento: "despesa",
          descricao: "Uber",
          valor: 20,
        },
      }).success,
    ).toBe(true);
    expect(
      registrar.safeParse({
        intencao_detectada: { intencao: "CONSULTAR_VISAO", tipo_visao: "saldos", filtros: {} },
      }).success,
    ).toBe(false);

    const orcamento = schema_por_ramo("orcamento");
    expect(
      orcamento.safeParse({
        intencao_detectada: {
          intencao: "DEFINIR_ORCAMENTO",
          valor_limite: 500,
          categoria_nome: "alimentação",
        },
      }).success,
    ).toBe(true);
  });
});
