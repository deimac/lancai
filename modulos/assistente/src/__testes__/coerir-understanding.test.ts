import { describe, expect, it } from "vitest";
import { ConversationUnderstandingSchema, estadoInicialConversacaoV3 } from "@lancai/tipos";
import { coerirUnderstandingComContexto } from "../agente/coerir-understanding";
import { understandingToNeed } from "../agente/understanding-to-need";
import { planQuery } from "../agente/query-planner";
import {
  AGORA,
  contextoAposConsultaFluxo,
  contextoAposConsultaUber,
  needFluxoPessoalEmpresa,
} from "./casos-understanding";

describe("coerirUnderstandingComContexto", () => {
  it("sem last_query não altera", () => {
    const u = ConversationUnderstandingSchema.parse({
      goal: "answer",
      question: { intent: "total", entities: { metric: "sum" }, implicit_filters: { tipo: "despesa" } },
      confidence: 0.9,
      required_sources: ["transactions"],
    });
    expect(coerirUnderstandingComContexto(u, estadoInicialConversacaoV3(AGORA))).toEqual(u);
  });

  it("depois de um total, turno sem assunto novo vira detalhe da mesma consulta", () => {
    const u = ConversationUnderstandingSchema.parse({
      goal: "answer",
      question: {
        intent: "total",
        entities: { metric: "sum", period: { tipo: "mes_atual" } },
        implicit_filters: { tipo: "despesa", tipoGasto: "pf", origemPerfil: "pj" },
      },
      confidence: 0.9,
      required_sources: ["transactions"],
    });
    const coerido = coerirUnderstandingComContexto(u, contextoAposConsultaFluxo());
    expect(coerido.goal).toBe("continue");
    expect(coerido.continuation).toMatchObject({
      type: "detail_request",
      inherits_from_previous: true,
    });

    const need = understandingToNeed(coerido, contextoAposConsultaFluxo(), {
      mensagem: "me detalhe os gastos",
    });
    expect(need?.expected_output).toBe("list");
    expect(need?.filters?.transactions).toMatchObject(needFluxoPessoalEmpresa().filters!.transactions);
    const plano = planQuery(need!, contextoAposConsultaFluxo());
    expect(plano.spec.visionType).toBe("fluxo");
    expect(plano.spec.aggregation).toBeUndefined();
  });

  it("intent list sem merchant herda o last_query", () => {
    const u = ConversationUnderstandingSchema.parse({
      goal: "answer",
      question: { intent: "list", implicit_filters: { tipo: "despesa" } },
      confidence: 0.88,
      required_sources: ["transactions"],
    });
    const coerido = coerirUnderstandingComContexto(u, contextoAposConsultaUber());
    expect(coerido.continuation?.type).toBe("detail_request");
    const need = understandingToNeed(coerido, contextoAposConsultaUber());
    expect(need?.filters?.transactions?.merchant).toBe("Uber");
    expect(need?.expected_output).toBe("list");
  });

  it("período novo sem merchant vira period_shift", () => {
    const u = ConversationUnderstandingSchema.parse({
      goal: "answer",
      question: {
        intent: "total",
        entities: { metric: "sum", period: { tipo: "mes_passado" } },
        implicit_filters: { tipo: "despesa" },
      },
      confidence: 0.9,
      required_sources: ["transactions"],
    });
    const coerido = coerirUnderstandingComContexto(u, contextoAposConsultaUber());
    expect(coerido.continuation).toMatchObject({
      type: "period_shift",
      inherits_from_previous: true,
    });
    const need = understandingToNeed(coerido, contextoAposConsultaUber(), { dataAtual: "2026-08-23" });
    expect(need?.filters?.transactions?.merchant).toBe("Uber");
    expect(need?.filters?.transactions?.periodo?.tipo).toBe("mes_passado");
    expect(need?.aggregation?.type).toBe("sum");
  });

  it("merchant novo é troca de assunto, não herda", () => {
    const u = ConversationUnderstandingSchema.parse({
      goal: "answer",
      question: {
        intent: "total",
        entities: { merchant: "iFood", metric: "sum", period: { tipo: "mes_atual" } },
        implicit_filters: { tipo: "despesa" },
      },
      confidence: 0.88,
      required_sources: ["transactions"],
    });
    expect(coerirUnderstandingComContexto(u, contextoAposConsultaUber())).toEqual(u);
  });

  it("execute/correção não vira consulta", () => {
    const u = ConversationUnderstandingSchema.parse({
      goal: "execute",
      question: { intent: "update", entities: { merchant: "Uber" } },
      confidence: 0.9,
      required_sources: ["transactions"],
    });
    expect(coerirUnderstandingComContexto(u, contextoAposConsultaUber())).toEqual(u);
  });
});
