import { describe, expect, it } from "vitest";
import {
  estadoInicialConversacaoV3,
  type ConversationUnderstanding,
  type InformationNeed,
  type QueryPlan,
} from "@lancai/tipos";
import {
  updateAfterExecution,
  updateAfterNeed,
  updateAfterPlan,
  updateAfterReferenceResolved,
  updateAfterUnderstanding,
} from "../agente/context-updater";
import { CASOS_UNDERSTANDING, MOVIMENTO_UBER, needUberMesAtual } from "./casos-understanding";

const AGORA = 2_000_000_000_000;
const MOV2 = "00000000-0000-4000-8000-000000000102";

function und(id: string): ConversationUnderstanding {
  return CASOS_UNDERSTANDING.find((c) => c.id === id)!.understanding;
}

describe("ContextUpdater", () => {
  it("understanding de consulta define goal analyze e domain spending", () => {
    const ctx = updateAfterUnderstanding(estadoInicialConversacaoV3(AGORA), und("consulta-total-uber"), {
      agora: AGORA,
    });
    expect(ctx.version).toBe(0);
    expect(ctx.active_goal).toBe("analyze");
    expect(ctx.active_topic?.domain).toBe("spending");
    expect(ctx.active_topic?.period).toEqual({ tipo: "mes_atual" });
    expect(ctx.active_topic?.metric).toBe("sum");
    expect(ctx.updated_at).toBe(AGORA);
  });

  it("understanding execute → active_goal execute", () => {
    const ctx = updateAfterUnderstanding(estadoInicialConversacaoV3(AGORA), und("create-uber-nubank"), {
      agora: AGORA,
    });
    expect(ctx.active_goal).toBe("execute");
  });

  it("correction → active_goal correct", () => {
    const ctx = updateAfterUnderstanding(estadoInicialConversacaoV3(AGORA), und("correcao-foi-ontem"), {
      agora: AGORA,
    });
    expect(ctx.active_goal).toBe("correct");
  });

  it("mudança de domínio empurra topic_history e limita a 10", () => {
    let ctx = estadoInicialConversacaoV3(AGORA);
    ctx = updateAfterUnderstanding(ctx, und("consulta-total-uber"), { agora: AGORA });
    for (let i = 0; i < 12; i++) {
      const receita: ConversationUnderstanding = {
        ...und("receita-total"),
        question: {
          ...und("receita-total").question!,
          entities: { metric: "sum", period: { tipo: i % 2 === 0 ? "mes_atual" : "mes_passado" } },
        },
      };
      const gasto = und("consulta-total-uber");
      ctx = updateAfterUnderstanding(ctx, i % 2 === 0 ? receita : gasto, { agora: AGORA + i + 1 });
    }
    expect(ctx.topic_history.length).toBe(10);
  });

  it("updateAfterNeed reforça período", () => {
    const need: InformationNeed = {
      ...needUberMesAtual(),
      filters: { transactions: { merchant: "Uber", periodo: { tipo: "mes_passado" } } },
    };
    const ctx = updateAfterNeed(estadoInicialConversacaoV3(AGORA), need, { agora: AGORA });
    expect(ctx.active_topic?.period).toEqual({ tipo: "mes_passado" });
    expect(ctx.topic_preferences?.default_period).toEqual({ tipo: "mes_passado" });
  });

  it("QueryPlan grava last_query sem result_ids ainda", () => {
    const plan: QueryPlan = {
      type: "query",
      spec: { merchant: "Uber", aggregation: "sum", visionType: "historico" },
    };
    const ctx = updateAfterPlan(estadoInicialConversacaoV3(AGORA), plan, {
      agora: AGORA,
      need: needUberMesAtual(),
    });
    expect(ctx.last_query?.query_spec.merchant).toBe("Uber");
    expect(ctx.last_query?.result_ids).toEqual([]);
    expect(ctx.last_query?.expires_at).toBe(AGORA + 10 * 60 * 1000);
  });

  it("execução de query preenche result_ids", () => {
    const comPlan = updateAfterPlan(
      estadoInicialConversacaoV3(AGORA),
      { type: "query", spec: { merchant: "Uber" } },
      { agora: AGORA, need: needUberMesAtual() },
    );
    const ctx = updateAfterExecution(comPlan, { success: true }, {
      agora: AGORA + 1,
      resultIds: [MOVIMENTO_UBER, MOV2],
    });
    expect(ctx.last_query?.result_ids).toEqual([MOVIMENTO_UBER, MOV2]);
    expect(ctx.last_query?.result_summary.count).toBe(2);
  });

  it("create define focused_entity e invalida last_query", () => {
    const base = updateAfterPlan(
      estadoInicialConversacaoV3(AGORA),
      { type: "query", spec: { merchant: "Uber" } },
      { agora: AGORA, need: needUberMesAtual() },
    );
    const ctx = updateAfterExecution(
      base,
      { success: true, entityRef: { id: MOVIMENTO_UBER, type: "transaction", label: "Uber" } },
      { agora: AGORA, command: { type: "create_transaction", input: { valor: 50, descricao: "Uber" } } },
    );
    expect(ctx.focused_entity?.id).toBe(MOVIMENTO_UBER);
    expect(ctx.last_query).toBeUndefined();
  });

  it("updateAfterReferenceResolved foca a entidade", () => {
    const ctx = updateAfterReferenceResolved(
      estadoInicialConversacaoV3(AGORA),
      { id: MOVIMENTO_UBER, type: "transaction", label: "Uber" },
      { agora: AGORA },
    );
    expect(ctx.focused_entity?.id).toBe(MOVIMENTO_UBER);
    expect(ctx.version).toBe(0);
  });

  it("topic_preferences.default_period após understanding com period", () => {
    const ctx = updateAfterUnderstanding(estadoInicialConversacaoV3(AGORA), und("consulta-total-uber"), {
      agora: AGORA,
    });
    expect(ctx.topic_preferences?.default_period).toEqual({ tipo: "mes_atual" });
  });
});
