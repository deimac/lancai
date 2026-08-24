import { describe, expect, it } from "vitest";
import { estadoInicialConversacao, type ConversationState } from "../assistente-v2";
import {
  CONTEXTO_SESSAO_DEFAULT_MISTO,
  CONTEXTO_SESSAO_DEFAULT_V1,
  CommandPlanSchema,
  ConversationUnderstandingSchema,
  contextoV3DeEstadoV1,
  estadoInicialConversacaoV3,
  estadoV1DeContextoV3,
  normalizarConversationContext,
  QueryPlanSchema,
} from "../assistente-v3";

const AGORA = 1_777_000_000_000;
const MOVIMENTO = "11111111-1111-4111-8111-111111111111";
const CONFIRMACAO = "22222222-2222-4222-8222-222222222222";

describe("ConversationUnderstandingSchema", () => {
  it("aceita consulta de total por merchant", () => {
    const lido = ConversationUnderstandingSchema.parse({
      goal: "answer",
      question: {
        intent: "total",
        entities: { merchant: "Uber", metric: "sum" },
        implicit_filters: { tipo: "despesa", fonte: "transacoes" },
      },
      confidence: 0.94,
      required_sources: ["transactions"],
    });
    expect(lido.goal).toBe("answer");
    expect(lido.question?.entities?.merchant).toBe("Uber");
  });

  it("aceita tipoGasto e origemPerfil no implicit_filters", () => {
    const lido = ConversationUnderstandingSchema.parse({
      goal: "answer",
      question: {
        intent: "total",
        entities: { metric: "sum" },
        implicit_filters: { tipo: "despesa", tipoGasto: "pf", origemPerfil: "pj" },
      },
      confidence: 0.9,
      required_sources: ["transactions"],
    });
    expect(lido.question?.implicit_filters).toMatchObject({
      tipoGasto: "pf",
      origemPerfil: "pj",
    });
  });

  it("aceita create com nomes, não IDs", () => {
    const lido = ConversationUnderstandingSchema.parse({
      goal: "execute",
      question: {
        intent: "create",
        entities: { merchant: "Uber", amount: 50, account: "Nubank" },
        implicit_filters: { tipo: "despesa" },
      },
      confidence: 0.9,
      required_sources: ["transactions", "accounts"],
    });
    expect(lido.question?.entities).toMatchObject({
      merchant: "Uber",
      amount: 50,
      account: "Nubank",
    });
    expect(lido.question?.entities).not.toHaveProperty("contaId");
  });

  it("aceita continuação period_shift", () => {
    const lido = ConversationUnderstandingSchema.parse({
      goal: "continue",
      continuation: {
        type: "period_shift",
        reference: { type: "temporal", relative: "last_month" },
        inherits_from_previous: true,
      },
      confidence: 0.88,
      required_sources: ["transactions"],
    });
    expect(lido.continuation?.type).toBe("period_shift");
    expect(lido.continuation?.inherits_from_previous).toBe(true);
  });

  it("rejeita goal inválido", () => {
    expect(() =>
      ConversationUnderstandingSchema.parse({
        goal: "chat",
        confidence: 1,
        required_sources: [],
      }),
    ).toThrow();
  });
});

describe("QueryPlan e CommandPlan", () => {
  it("parseia QueryPlan de listagem", () => {
    expect(
      QueryPlanSchema.parse({
        type: "query",
        spec: { merchant: "Uber", aggregation: "sum" },
        computation: { type: "none" },
      }).type,
    ).toBe("query");
  });

  it("parseia CommandPlan de create sem InformationNeed", () => {
    const plano = CommandPlanSchema.parse({
      type: "command",
      steps: [
        {
          stepId: "1",
          description: "Lançar Uber R$ 50",
          command: {
            type: "create_transaction",
            input: { descricao: "Uber", valor: 50 },
          },
        },
      ],
    });
    expect(plano.steps).toHaveLength(1);
    expect(plano.steps[0]?.command.type).toBe("create_transaction");
  });
});

describe("adapter ConversationState v1 ↔ ConversationContext v3", () => {
  it("promove o default da migration 0032", () => {
    const ctx = normalizarConversationContext(CONTEXTO_SESSAO_DEFAULT_V1, AGORA);
    expect(ctx.schemaVersion).toBe(2);
    expect(ctx.version).toBe(0);
    expect(ctx.active_topic).toBeNull();
    expect(ctx.focused_entity).toBeNull();
    expect(ctx.pending_action).toBeNull();
    expect(ctx.topic_history).toEqual([]);
    expect(ctx.updated_at).toBe(AGORA);
  });

  it("promove o default misto da migration 0033 e o SessionManager ainda lê v1", () => {
    const ctx = normalizarConversationContext(CONTEXTO_SESSAO_DEFAULT_MISTO, AGORA);
    expect(ctx.schemaVersion).toBe(2);
    expect(ctx.topic_history).toEqual([]);
    expect(ctx.updated_at).toBe(1);
    const v1 = estadoV1DeContextoV3(ctx);
    expect(v1.schemaVersion).toBe(1);
    expect(v1.version).toBe(0);
  });

  it("roundtrip preserva ids, entidade, confirmação e version", () => {
    const v1: ConversationState = {
      schemaVersion: 1,
      version: 4,
      lastResultSet: {
        ids: [MOVIMENTO],
        query: { merchant: "Uber", period: { tipo: "mes_atual" } },
        expiresAt: AGORA + 60_000,
      },
      currentEntity: { id: MOVIMENTO, type: "transaction", label: "Uber" },
      pendingConfirmation: {
        confirmationId: CONFIRMACAO,
        requestHash: "abc123",
        stateVersion: 4,
        message: "Confirmar alteração?",
        options: ["sim", "não"],
        expiresAt: AGORA + 120_000,
      },
      explicitPeriod: { tipo: "mes_atual" },
      userPreferencesRef: { defaultProfile: "pf" },
    };

    const v3 = contextoV3DeEstadoV1(v1, AGORA);
    expect(v3.schemaVersion).toBe(2);
    expect(v3.last_query?.result_ids).toEqual([MOVIMENTO]);
    expect(v3.focused_entity?.id).toBe(MOVIMENTO);
    expect(v3.pending_action?.type).toBe("confirmation");
    expect(v3.active_topic?.period).toEqual({ tipo: "mes_atual" });

    const deVolta = estadoV1DeContextoV3(v3);
    expect(deVolta.schemaVersion).toBe(1);
    expect(deVolta.version).toBe(4);
    expect(deVolta.lastResultSet?.ids).toEqual([MOVIMENTO]);
    expect(deVolta.currentEntity).toEqual(v1.currentEntity);
    expect(deVolta.pendingConfirmation).toEqual(v1.pendingConfirmation);
    expect(deVolta.explicitPeriod).toEqual({ tipo: "mes_atual" });
    expect(deVolta.userPreferencesRef).toEqual({ defaultProfile: "pf" });
  });

  it("estado inicial v3 não quebra o v1 vazio", () => {
    const v3 = estadoInicialConversacaoV3(AGORA);
    const v1 = estadoV1DeContextoV3(v3);
    expect(v1).toMatchObject({
      schemaVersion: 1,
      version: 0,
      userPreferencesRef: {},
    });
    expect(estadoInicialConversacao().schemaVersion).toBe(1);
  });
});
