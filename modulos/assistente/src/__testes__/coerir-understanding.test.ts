import { describe, expect, it } from "vitest";
import { ConversationUnderstandingSchema, estadoInicialConversacaoV3 } from "@lancai/tipos";
import { coerirUnderstandingComContexto } from "../agente/coerir-understanding";
import { understandingToNeed } from "../agente/understanding-to-need";
import { planQuery } from "../agente/query-planner";
import {
  AGORA,
  contextoAposConsultaFluxo,
  contextoAposConsultaUber,
  contextoAposDetalheSaidasMercadoPago,
  contextoAposSaidasMercadoPago,
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
    expect(need?.filters?.transactions).toMatchObject(needFluxoPessoalEmpresa().filters!.transactions!);
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

  it("e domingo? após um total vira period_shift, não detalhe", () => {
    const u = ConversationUnderstandingSchema.parse({
      goal: "answer",
      question: {
        intent: "total",
        entities: { metric: "sum" },
        implicit_filters: { tipo: "despesa" },
      },
      confidence: 0.8,
      required_sources: ["transactions"],
    });
    const contexto = contextoAposSaidasMercadoPago("2026-08-22");
    const coerido = coerirUnderstandingComContexto(u, contexto, {
      mensagem: "e domingo?",
      dataAtual: "2026-08-23",
    });
    expect(coerido.continuation).toMatchObject({
      type: "period_shift",
      inherits_from_previous: true,
    });
    const need = understandingToNeed(coerido, contexto, {
      mensagem: "e domingo?",
      dataAtual: "2026-08-23",
    });
    expect(need?.aggregation?.type).toBe("sum");
    expect(need?.filters?.transactions?.contaNome).toBe("Mercado Pago");
    expect(need?.filters?.transactions?.periodo).toEqual({
      tipo: "personalizado",
      de: "2026-08-23",
      ate: "2026-08-23",
    });
  });

  it("e domingo? no mesmo dia de ontem ainda é period_shift", () => {
    const u = ConversationUnderstandingSchema.parse({
      goal: "answer",
      question: {
        intent: "total",
        entities: {
          metric: "sum",
          period: { tipo: "personalizado", de: "2026-08-23", ate: "2026-08-23" },
        },
        implicit_filters: { tipo: "despesa" },
      },
      confidence: 0.8,
      required_sources: ["transactions"],
    });
    const contexto = contextoAposSaidasMercadoPago("2026-08-23");
    const coerido = coerirUnderstandingComContexto(u, contexto, {
      mensagem: "e domingo?",
      dataAtual: "2026-08-24",
    });
    expect(coerido.continuation?.type).toBe("period_shift");
    expect(coerido.continuation?.type).not.toBe("detail_request");
  });

  it("e no sábado? depois do detalhe continua a lista no sábado, não corrige a data", () => {
    const u = ConversationUnderstandingSchema.parse({
      goal: "continue",
      continuation: {
        type: "correction",
        reference: { type: "temporal", relative: "saturday" },
        inherits_from_previous: true,
      },
      confidence: 0.8,
      required_sources: ["transactions"],
    });
    const contexto = contextoAposDetalheSaidasMercadoPago("2026-08-23");
    const coerido = coerirUnderstandingComContexto(u, contexto, {
      mensagem: "e no sabado?",
      dataAtual: "2026-08-23",
    });
    expect(coerido.continuation).toMatchObject({
      type: "period_shift",
      reference: { type: "temporal", relative: "saturday" },
    });
    const need = understandingToNeed(coerido, contexto, {
      mensagem: "e no sabado?",
      dataAtual: "2026-08-23",
    });
    expect(need?.expected_output).toBe("list");
    expect(need?.filters?.transactions?.periodo).toEqual({
      tipo: "personalizado",
      de: "2026-08-22",
      ate: "2026-08-22",
    });
    expect(need?.filters?.transactions?.contaNome).toBe("Mercado Pago");
  });

  it("pergunta nova completa não herda a conta da consulta anterior", () => {
    const u = ConversationUnderstandingSchema.parse({
      goal: "answer",
      question: {
        intent: "total",
        entities: { metric: "sum", period: { tipo: "personalizado", de: "2026-08-23", ate: "2026-08-23" } },
        implicit_filters: { tipo: "despesa", origemPerfil: "pj" },
      },
      confidence: 0.9,
      required_sources: ["transactions"],
    });
    const coerido = coerirUnderstandingComContexto(u, contextoAposSaidasMercadoPago("2026-08-10"), {
      mensagem: "quanto tive de saidas ontem da minha conta da empresa?",
      dataAtual: "2026-08-24",
    });
    expect(coerido.goal).toBe("answer");
    expect(coerido.continuation).toBeUndefined();
    const need = understandingToNeed(coerido, contextoAposSaidasMercadoPago("2026-08-10"), {
      mensagem: "quanto tive de saidas ontem da minha conta da empresa?",
      dataAtual: "2026-08-24",
    });
    expect(need?.filters?.transactions?.contaNome).toBeUndefined();
    expect(need?.filters?.transactions?.origemPerfil).toBe("pj");
  });
});
