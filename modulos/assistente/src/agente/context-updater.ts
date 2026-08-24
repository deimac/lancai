import {
  ConversationContextSchema,
  informationNeedDeQuerySpec,
  type ActiveGoal,
  type ActiveTopic,
  type CommandResult,
  type ConversationContext,
  type ConversationUnderstanding,
  type EntityRef,
  type ExecutionPlan,
  type InformationNeed,
  type QueryPlan,
  type SimpleCommand,
} from "@lancai/tipos";

const TTL_RESULTSET_MS = 10 * 60 * 1000;

export type ContextUpdaterOpcoes = {
  agora?: number;
  need?: InformationNeed;
  command?: SimpleCommand;
  resultIds?: string[];
};

function instante(opcoes?: ContextUpdaterOpcoes): number {
  const n = opcoes?.agora ?? Date.now();
  return n > 0 ? n : 1;
}

function gravar(ctx: ConversationContext): ConversationContext {
  return ConversationContextSchema.parse(ctx);
}

function goalDe(understanding: ConversationUnderstanding): ActiveGoal | null {
  if (understanding.continuation?.type === "correction") return "correct";
  switch (understanding.goal) {
    case "execute":
      return "execute";
    case "answer":
    case "continue":
      return "analyze";
    case "clarify":
      return "explore";
    case "confirm":
    case "greet":
      return null;
  }
}

function dominioDe(understanding: ConversationUnderstanding): ActiveTopic["domain"] {
  const fontes = understanding.required_sources;
  const entities = understanding.question?.entities;
  const tipo = understanding.question?.implicit_filters?.tipo;
  if (fontes.includes("recurrences") && fontes.length === 1) return "recurrences";
  if (entities?.metric === "balance" || (fontes.includes("accounts") && !fontes.includes("transactions"))) {
    return "balance";
  }
  if (entities?.metric === "available" || (entities?.card && fontes.includes("cards") && !entities.merchant)) {
    return "cards";
  }
  if (tipo === "receita") return "income";
  if (understanding.question?.intent === "breakdown") return "categories";
  if (tipo === "despesa" || entities?.merchant || understanding.goal === "answer") return "spending";
  return undefined;
}

function metricDe(understanding: ConversationUnderstanding): ActiveTopic["metric"] {
  const m = understanding.question?.entities?.metric;
  if (m === "sum" || m === "count" || m === "balance" || m === "available") return m;
  if (understanding.question?.intent === "total") return "sum";
  return undefined;
}

function empilharSeMudou(
  ctx: ConversationContext,
  dominio: ActiveTopic["domain"],
  agora: number,
): ConversationContext["topic_history"] {
  const atual = ctx.active_topic?.domain;
  if (!atual || !dominio || atual === dominio) return ctx.topic_history;
  const item = {
    topic: {
      domain: atual,
      entities: ctx.active_topic?.entities ?? [],
    },
    goal: ctx.active_goal ?? "analyze",
    started_at: agora,
  };
  return [...ctx.topic_history, item].slice(-10);
}

export function updateAfterUnderstanding(
  ctx: ConversationContext,
  understanding: ConversationUnderstanding,
  opcoes: ContextUpdaterOpcoes = {},
): ConversationContext {
  const agora = instante(opcoes);
  const goal = goalDe(understanding);
  const dominio = dominioDe(understanding);
  const period = understanding.question?.entities?.period;
  const metric = metricDe(understanding);
  const history = empilharSeMudou(ctx, dominio, agora);

  const topic: ActiveTopic | null =
    dominio || period || metric || ctx.active_topic
      ? {
          ...(ctx.active_topic ?? {}),
          ...(dominio ? { domain: dominio } : {}),
          ...(metric ? { metric } : {}),
          ...(period ? { period } : {}),
        }
      : ctx.active_topic;

  const prefs = period
    ? { ...ctx.topic_preferences, default_period: period }
    : ctx.topic_preferences;

  return gravar({
    ...ctx,
    active_goal: goal ?? ctx.active_goal,
    active_topic: topic,
    topic_history: history,
    topic_preferences: prefs,
    updated_at: agora,
  });
}

export function updateAfterNeed(
  ctx: ConversationContext,
  need: InformationNeed,
  opcoes: ContextUpdaterOpcoes = {},
): ConversationContext {
  const agora = instante(opcoes);
  const period = need.filters?.transactions?.periodo;
  const metric =
    need.aggregation?.type === "sum" || need.aggregation?.type === "count"
      ? need.aggregation.type
      : ctx.active_topic?.metric;
  return gravar({
    ...ctx,
    active_topic: {
      ...(ctx.active_topic ?? {}),
      ...(period ? { period } : {}),
      ...(metric ? { metric } : {}),
    },
    topic_preferences: period ? { ...ctx.topic_preferences, default_period: period } : ctx.topic_preferences,
    updated_at: agora,
  });
}

export function updateAfterPlan(
  ctx: ConversationContext,
  plan: ExecutionPlan,
  opcoes: ContextUpdaterOpcoes = {},
): ConversationContext {
  const agora = instante(opcoes);
  if (plan.type !== "query") {
    return gravar({ ...ctx, updated_at: agora });
  }
  const query = plan as QueryPlan;
  const need = opcoes.need ?? informationNeedDeQuerySpec(query.spec);
  return gravar({
    ...ctx,
    last_query: {
      information_need: need,
      query_spec: query.spec,
      result_ids: [],
      result_summary: { count: 0, period: query.spec.period },
      expires_at: agora + TTL_RESULTSET_MS,
    },
    updated_at: agora,
  });
}

export function updateAfterExecution(
  ctx: ConversationContext,
  result: CommandResult,
  opcoes: ContextUpdaterOpcoes = {},
): ConversationContext {
  const agora = instante(opcoes);
  if (!result.success) {
    return gravar({ ...ctx, pending_action: null, updated_at: agora });
  }

  let last_query = ctx.last_query;
  let focused = ctx.focused_entity;
  const command = opcoes.command;
  const entityRef = result.entityRef;

  if (opcoes.resultIds && last_query) {
    last_query = {
      ...last_query,
      result_ids: opcoes.resultIds,
      result_summary: { ...last_query.result_summary, count: opcoes.resultIds.length },
      expires_at: agora + TTL_RESULTSET_MS,
    };
  }

  if (entityRef?.type === "transaction") {
    if (last_query?.result_ids.includes(entityRef.id)) last_query = undefined;
    if (command?.type === "create_transaction") {
      last_query = undefined;
      focused = entityRef;
    } else if (command?.type === "cancel_transaction") {
      focused = focused?.id === entityRef.id ? null : focused;
    } else if (focused?.id === entityRef.id || command?.type === "update_transaction") {
      focused = entityRef;
    }
  } else if (entityRef) {
    focused = entityRef;
  }

  return gravar({
    ...ctx,
    last_query,
    focused_entity: focused,
    pending_action: null,
    updated_at: agora,
  });
}

export function updateAfterReferenceResolved(
  ctx: ConversationContext,
  entity: EntityRef,
  opcoes: ContextUpdaterOpcoes = {},
): ConversationContext {
  return gravar({
    ...ctx,
    focused_entity: entity,
    updated_at: instante(opcoes),
  });
}

export function updateConversationContext(
  ctx: ConversationContext,
  etapa:
    | { after: "understanding"; understanding: ConversationUnderstanding }
    | { after: "need"; need: InformationNeed }
    | { after: "plan"; plan: ExecutionPlan }
    | { after: "execution"; result: CommandResult }
    | { after: "reference"; entity: EntityRef },
  opcoes: ContextUpdaterOpcoes = {},
): ConversationContext {
  switch (etapa.after) {
    case "understanding":
      return updateAfterUnderstanding(ctx, etapa.understanding, opcoes);
    case "need":
      return updateAfterNeed(ctx, etapa.need, opcoes);
    case "plan":
      return updateAfterPlan(ctx, etapa.plan, opcoes);
    case "execution":
      return updateAfterExecution(ctx, etapa.result, opcoes);
    case "reference":
      return updateAfterReferenceResolved(ctx, etapa.entity, opcoes);
  }
}

export const ContextUpdater = {
  updateAfterUnderstanding,
  updateAfterNeed,
  updateAfterPlan,
  updateAfterExecution,
  updateAfterReferenceResolved,
  updateConversationContext,
};
