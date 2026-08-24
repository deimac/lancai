import { describe, expect, it, vi } from "vitest";
import { estadoInicialConversacaoV3, type ResolutionResult } from "@lancai/tipos";
import { planCommand } from "../agente/command-planner";
import {
  updateAfterExecution,
  updateAfterPlan,
  updateAfterReferenceResolved,
  updateAfterUnderstanding,
} from "../agente/context-updater";
import { planQuery } from "../agente/query-planner";
import type { EntityBusca, ResolverDeps } from "../agente/reference-resolver";
import { ReferenceResolverV3 } from "../agente/reference-resolver-v3";
import { understandingToNeed } from "../agente/understanding-to-need";
import {
  AGORA,
  CASOS_UNDERSTANDING,
  DATA_ATUAL,
  MOVIMENTO_UBER,
  contextoAposConsultaUber,
} from "./casos-understanding";

function caso(id: string) {
  const c = CASOS_UNDERSTANDING.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
}

const MOV_B = "00000000-0000-4000-8000-000000000102";
const MOV_C = "00000000-0000-4000-8000-000000000103";

function depsLista(): ResolverDeps {
  const entidades: EntityBusca[] = [
    { id: MOVIMENTO_UBER, type: "transaction", label: "Uber 42", metadata: { merchant: "Uber", valor: 42, dataMovimento: "2026-08-21" } },
    { id: MOV_B, type: "transaction", label: "Uber 35", metadata: { merchant: "Uber", valor: 35, dataMovimento: "2026-08-22" } },
    { id: MOV_C, type: "transaction", label: "Uber 62", metadata: { merchant: "Uber", valor: 62, dataMovimento: "2026-08-20" } },
  ];
  const porId = new Map(entidades.map((e) => [e.id, e]));
  return {
    getEntityById: vi.fn(async (id: string) => porId.get(id) ?? null),
    getEntitiesByIds: vi.fn(async (ids: string[]) =>
      ids.map((id) => porId.get(id)).filter((e): e is EntityBusca => Boolean(e)),
    ),
    searchEntities: vi.fn(async () => entidades),
  };
}

const resolvidoUber: ResolutionResult = {
  status: "resolved",
  entity: {
    entity: { id: MOVIMENTO_UBER, type: "transaction", label: "Uber" },
    confidence: 1,
    method: "anaphoric",
  },
};

describe("Pipeline Understanding → Need → Plan → Resolver → ContextUpdate", () => {
  it("create: Need null + CommandPlan create_transaction", () => {
    const c = caso("create-uber-nubank");
    const need = understandingToNeed(c.understanding, c.context);
    const command = planCommand(c.understanding);
    expect(need).toBeNull();
    expect(command?.kind).toBe("plan");
    if (command?.kind === "plan") {
      expect(command.plan.steps[0]?.command.type).toBe("create_transaction");
    }
    const ctx = updateAfterUnderstanding(estadoInicialConversacaoV3(AGORA), c.understanding, { agora: AGORA });
    expect(ctx.active_goal).toBe("execute");
  });

  it("total Uber: QueryPlan historico + sum", () => {
    const c = caso("consulta-total-uber");
    const need = understandingToNeed(c.understanding, c.context);
    expect(need).not.toBeNull();
    const plano = planQuery(need!, c.context);
    expect(plano.spec.visionType).toBe("historico");
    expect(plano.spec.aggregation).toBe("sum");
    expect(plano.spec.merchant).toBe("Uber");
    const ctx = updateAfterPlan(
      updateAfterUnderstanding(estadoInicialConversacaoV3(AGORA), c.understanding, { agora: AGORA }),
      plano,
      { agora: AGORA, need: need! },
    );
    expect(ctx.last_query?.query_spec.merchant).toBe("Uber");
  });

  it("period_shift herda Uber e troca para mes_passado", () => {
    const c = caso("continue-period-shift");
    const need = understandingToNeed(c.understanding, c.context, { dataAtual: DATA_ATUAL });
    const plano = planQuery(need!, c.context);
    expect(plano.spec.merchant).toBe("Uber");
    expect(plano.spec.period).toEqual({ tipo: "mes_passado" });
    expect(plano.spec.aggregation).toBe("sum");
  });

  it("e domingo herda a conta e troca o dia", () => {
    const c = caso("continue-period-shift-domingo");
    const need = understandingToNeed(c.understanding, c.context, {
      dataAtual: DATA_ATUAL,
      mensagem: c.mensagem,
    });
    const plano = planQuery(need!, c.context);
    expect(plano.spec.contaNome).toBe("Mercado Pago");
    expect(plano.spec.period).toEqual({ tipo: "personalizado", de: "2026-08-23", ate: "2026-08-23" });
    expect(plano.spec.aggregation).toBe("sum");
  });

  it("filter_add cartão no Need e no QueryPlan", () => {
    const c = caso("continue-filter-add-cartao");
    const need = understandingToNeed(c.understanding, c.context);
    const plano = planQuery(need!, c.context);
    expect(plano.spec.merchant).toBe("Uber");
    expect(plano.spec.cartaoNome).toBe("Revolut Visa");
    expect(plano.computation?.params?.fallback_sources).toEqual(["cards"]);
  });

  it("foi ontem: focused_entity + update dataMovimento", () => {
    const c = caso("correcao-foi-ontem");
    expect(understandingToNeed(c.understanding, c.context)).toBeNull();
    const focused = c.context!.focused_entity!;
    const resolved: ResolutionResult = {
      status: "resolved",
      entity: { entity: focused, confidence: 1, method: "anaphoric" },
    };
    const command = planCommand(c.understanding, { resolved, dataAtual: DATA_ATUAL });
    expect(command?.kind).toBe("plan");
    if (command?.kind === "plan" && command.plan.steps[0]?.command.type === "update_transaction") {
      expect(command.plan.steps[0].command.input.movementId).toBe(MOVIMENTO_UBER);
      expect(command.plan.steps[0].command.input.fatoPatch?.dataMovimento).toBe("2026-08-22");
    }
  });

  it("o segundo: positional no last_query", async () => {
    const c = caso("ref-posicional-segundo");
    const context = {
      ...contextoAposConsultaUber(),
      last_query: {
        ...contextoAposConsultaUber().last_query!,
        result_ids: [MOVIMENTO_UBER, MOV_B, MOV_C],
      },
    };
    const resolver = new ReferenceResolverV3(depsLista());
    const resolved = await resolver.resolve(
      { type: "positional", index: 2 },
      context,
      { usuarioId: "00000000-0000-4000-8000-000000000001", currentDate: DATA_ATUAL },
      AGORA,
    );
    expect(resolved.status).toBe("resolved");
    if (resolved.status === "resolved") expect(resolved.entity.entity.id).toBe(MOV_B);
    const command = planCommand(c.understanding, { resolved });
    expect(command?.kind).toBe("plan");
    const ctx = updateAfterReferenceResolved(context, resolved.status === "resolved" ? resolved.entity.entity : { id: MOV_B, type: "transaction", label: "x" }, { agora: AGORA });
    expect(ctx.focused_entity?.id).toBe(MOV_B);
  });

  it("ambíguo: clarify, sem CommandPlan de execução", () => {
    const c = caso("ambiguidade-tres-ubers");
    const command = planCommand(c.understanding, { resolved: resolvidoUber });
    expect(command?.kind).toBe("clarify");
    expect(understandingToNeed(c.understanding, c.context)).toBeNull();
  });

  it("compare: QueryPlan computation diff", () => {
    const c = caso("compare-mes-passado");
    const need = understandingToNeed(c.understanding, c.context);
    const plano = planQuery(need!);
    expect(plano.computation?.type).toBe("diff");
    expect(plano.spec.aggregation).toBe("sum");
  });

  it("saldo: QueryPlan visionType saldos", () => {
    const c = caso("saldo-nubank");
    const need = understandingToNeed(c.understanding, c.context);
    const plano = planQuery(need!);
    expect(plano.spec.visionType).toBe("saldos");
    expect(plano.spec.entityType).toBe("account");
    expect(plano.spec.contaNome).toBe("Nubank");
  });

  it("detalhe após fluxo lista os lançamentos cruzados, não soma de novo", () => {
    const c = caso("continue-detail-fluxo");
    const need = understandingToNeed(c.understanding, c.context, { mensagem: c.mensagem });
    expect(need?.expected_output).toBe("list");
    expect(need?.aggregation?.type).toBe("none");
    const plano = planQuery(need!, c.context);
    expect(plano.spec.visionType).toBe("fluxo");
    expect(plano.spec.aggregation).toBeUndefined();
    expect(plano.spec.direcao).toBe("pessoal_com_empresa");
  });

  it("paráfrases de pessoal na empresa montam a mesma visão fluxo", () => {
    for (const id of [
      "consulta-fluxo-pessoal-empresa",
      "consulta-fluxo-usei-pj-coisa-minha",
      "consulta-fluxo-empresa-pagou-minhas-coisas",
    ]) {
      const c = caso(id);
      const need = understandingToNeed(c.understanding, c.context, { mensagem: c.mensagem });
      expect(need).not.toBeNull();
      const plano = planQuery(need!, c.context);
      expect(plano.spec.visionType).toBe("fluxo");
      expect(plano.spec.direcao).toBe("pessoal_com_empresa");
      expect(plano.spec.aggregation).toBe("sum");
    }
  });

  it("extrato da conta da empresa continua historico", () => {
    const c = caso("consulta-extrato-conta-empresa");
    const need = understandingToNeed(c.understanding, c.context, { mensagem: c.mensagem });
    const plano = planQuery(need!, c.context);
    expect(plano.spec.visionType).toBe("historico");
    expect(plano.spec.direcao).toBeUndefined();
  });

  it("greet: Need null e CommandPlan null", () => {
    const c = caso("greet");
    expect(understandingToNeed(c.understanding, c.context)).toBeNull();
    expect(planCommand(c.understanding)).toBeNull();
    const ctx = updateAfterUnderstanding(estadoInicialConversacaoV3(AGORA), c.understanding, { agora: AGORA });
    expect(ctx.active_goal).toBeNull();
  });

  it("create + execução atualiza focused_entity", () => {
    const c = caso("create-uber-nubank");
    const command = planCommand(c.understanding);
    expect(command?.kind).toBe("plan");
    const ctx = updateAfterExecution(
      updateAfterUnderstanding(estadoInicialConversacaoV3(AGORA), c.understanding, { agora: AGORA }),
      { success: true, entityRef: { id: MOVIMENTO_UBER, type: "transaction", label: "Uber" } },
      {
        agora: AGORA,
        command: command?.kind === "plan" ? command.plan.steps[0]?.command : undefined,
      },
    );
    expect(ctx.focused_entity?.id).toBe(MOVIMENTO_UBER);
  });
});
