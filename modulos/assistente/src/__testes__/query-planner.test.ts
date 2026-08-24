import { describe, expect, it } from "vitest";
import {
  InformationNeedSchema,
  estadoInicialConversacaoV3,
  type ConversationContext,
  type InformationNeed,
} from "@lancai/tipos";
import { planQuery } from "../agente/query-planner";

function need(bruto: InformationNeed): InformationNeed {
  return InformationNeedSchema.parse(bruto);
}

const AGORA = 1_777_000_000_000;

describe("planQuery", () => {
  it("filtro merchant + período + sum → historico", () => {
    const plano = planQuery(
      need({
        data_sources: ["transactions"],
        source_priority: ["transactions"],
        filters: { transactions: { merchant: "Uber", periodo: { tipo: "mes_atual" }, tipos: ["despesa"] } },
        aggregation: { type: "sum", field: "valor" },
        expected_output: "single_value",
      }),
    );
    expect(plano.type).toBe("query");
    expect(plano.spec).toMatchObject({
      merchant: "Uber",
      period: { tipo: "mes_atual" },
      tipos: ["despesa"],
      aggregation: "sum",
      visionType: "historico",
      entityType: "transaction",
    });
    expect(plano.spec.contaId).toBeUndefined();
  });

  it("filtro contaNome", () => {
    const plano = planQuery(
      need({
        data_sources: ["transactions"],
        source_priority: ["transactions"],
        filters: { transactions: { contaNome: "Nubank" } },
        aggregation: { type: "sum", field: "valor" },
        expected_output: "single_value",
      }),
    );
    expect(plano.spec.contaNome).toBe("Nubank");
  });

  it("cruzado vira visão fluxo, não extrato da conta", () => {
    const plano = planQuery(
      need({
        data_sources: ["transactions"],
        source_priority: ["transactions"],
        filters: {
          transactions: { cruzado: true, tipos: ["despesa"], periodo: { tipo: "mes_atual" } },
        },
        aggregation: { type: "sum", field: "valor" },
        expected_output: "single_value",
      }),
    );
    expect(plano.spec.visionType).toBe("fluxo");
    expect(plano.spec.aggregation).toBe("sum");
  });

  it("filtro cartaoNome", () => {
    const plano = planQuery(
      need({
        data_sources: ["transactions"],
        source_priority: ["transactions"],
        filters: { transactions: { cartaoNome: "Revolut Visa" } },
        expected_output: "list",
      }),
    );
    expect(plano.spec.cartaoNome).toBe("Revolut Visa");
  });

  it("período mes_passado", () => {
    const plano = planQuery(
      need({
        data_sources: ["transactions"],
        source_priority: ["transactions"],
        filters: { transactions: { periodo: { tipo: "mes_passado" } } },
        aggregation: { type: "sum", field: "valor" },
        expected_output: "single_value",
      }),
    );
    expect(plano.spec.period).toEqual({ tipo: "mes_passado" });
  });

  it("aggregation count", () => {
    const plano = planQuery(
      need({
        data_sources: ["transactions"],
        source_priority: ["transactions"],
        aggregation: { type: "count", field: "valor" },
        expected_output: "single_value",
      }),
    );
    expect(plano.spec.aggregation).toBe("count");
  });

  it("aggregation none não vai no spec", () => {
    const plano = planQuery(
      need({
        data_sources: ["transactions"],
        source_priority: ["transactions"],
        aggregation: { type: "none", field: "valor" },
        expected_output: "list",
      }),
    );
    expect(plano.spec.aggregation).toBeUndefined();
  });

  it("breakdown → groupBy categoria + visionType categoria", () => {
    const plano = planQuery(
      need({
        data_sources: ["transactions", "categories"],
        source_priority: ["transactions", "categories"],
        aggregation: { type: "sum", field: "valor", group_by: ["category"] },
        computation: { type: "breakdown", params: { group_by: "category" } },
        expected_output: "table",
      }),
    );
    expect(plano.spec.groupBy).toBe("categoria");
    expect(plano.spec.visionType).toBe("categoria");
    expect(plano.computation?.type).toBe("breakdown");
  });

  it("top_n → limit e computation", () => {
    const plano = planQuery(
      need({
        data_sources: ["transactions"],
        source_priority: ["transactions"],
        aggregation: { type: "sum", field: "valor", group_by: ["merchant"] },
        computation: { type: "top_n", params: { n: 5 } },
        expected_output: "table",
      }),
    );
    expect(plano.spec.limit).toBe(5);
    expect(plano.spec.groupBy).toBe("merchant");
    expect(plano.computation?.type).toBe("top_n");
  });

  it("diff a partir de comparison", () => {
    const plano = planQuery(
      need({
        data_sources: ["transactions"],
        source_priority: ["transactions"],
        aggregation: { type: "sum", field: "valor" },
        computation: { type: "comparison" },
        expected_output: "comparison",
      }),
    );
    expect(plano.computation?.type).toBe("diff");
  });

  it("trend", () => {
    const plano = planQuery(
      need({
        data_sources: ["transactions"],
        source_priority: ["transactions"],
        computation: { type: "trend" },
        expected_output: "chart",
      }),
    );
    expect(plano.computation?.type).toBe("trend");
  });

  it("explanation", () => {
    const plano = planQuery(
      need({
        data_sources: ["transactions"],
        source_priority: ["transactions"],
        computation: { type: "explanation" },
        expected_output: "explanation",
      }),
    );
    expect(plano.computation?.type).toBe("explanation");
  });

  it("accounts → saldos", () => {
    const plano = planQuery(
      need({
        data_sources: ["accounts"],
        source_priority: ["accounts"],
        filters: { accounts: { nome: "Nubank" } },
        expected_output: "single_value",
      }),
    );
    expect(plano.spec.visionType).toBe("saldos");
    expect(plano.spec.entityType).toBe("account");
    expect(plano.spec.contaNome).toBe("Nubank");
  });

  it("cards → cartoes", () => {
    const plano = planQuery(
      need({
        data_sources: ["cards"],
        source_priority: ["cards"],
        filters: { cards: { nome: "Nubank" } },
        expected_output: "single_value",
      }),
    );
    expect(plano.spec.visionType).toBe("cartoes");
    expect(plano.spec.entityType).toBe("card");
    expect(plano.spec.cartaoNome).toBe("Nubank");
  });

  it("list → limit 50 e orderBy data", () => {
    const plano = planQuery(
      need({
        data_sources: ["transactions"],
        source_priority: ["transactions"],
        expected_output: "list",
      }),
    );
    expect(plano.spec.limit).toBe(50);
    expect(plano.spec.orderBy).toBe("data");
    expect(plano.spec.orderDir).toBe("desc");
    expect(plano.spec.visionType).toBe("historico");
  });

  it("fallback_sources nas params da computation", () => {
    const plano = planQuery(
      need({
        data_sources: ["transactions", "cards"],
        source_priority: ["transactions", "cards"],
        aggregation: { type: "sum", field: "valor" },
        expected_output: "single_value",
      }),
    );
    expect(plano.computation?.type).toBe("none");
    expect(plano.computation?.params?.fallback_sources).toEqual(["cards"]);
  });

  it("herda período do ConversationContext se o Need não tem", () => {
    const context: ConversationContext = {
      ...estadoInicialConversacaoV3(AGORA),
      active_topic: { domain: "spending", period: { tipo: "mes_passado" } },
    };
    const plano = planQuery(
      need({
        data_sources: ["transactions"],
        source_priority: ["transactions"],
        aggregation: { type: "sum", field: "valor" },
        expected_output: "single_value",
      }),
      context,
    );
    expect(plano.spec.period).toEqual({ tipo: "mes_passado" });
  });

  it("Need com período ganha do contexto", () => {
    const context: ConversationContext = {
      ...estadoInicialConversacaoV3(AGORA),
      topic_preferences: { default_period: { tipo: "ano_atual" } },
    };
    const plano = planQuery(
      need({
        data_sources: ["transactions"],
        source_priority: ["transactions"],
        filters: { transactions: { periodo: { tipo: "mes_atual" } } },
        expected_output: "single_value",
      }),
      context,
    );
    expect(plano.spec.period).toEqual({ tipo: "mes_atual" });
  });
});
