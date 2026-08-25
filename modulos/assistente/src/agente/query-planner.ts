import {
  QueryPlanSchema,
  type ConversationContext,
  type InformationNeed,
  type QueryPlan,
  type QuerySpec,
} from "@lancai/tipos";

const GROUP_BY: Record<string, NonNullable<QuerySpec["groupBy"]>> = {
  category: "categoria",
  categoria: "categoria",
  merchant: "merchant",
  account: "conta",
  conta: "conta",
  card: "cartao",
  cartao: "cartao",
  perfil: "perfil",
  pessoa: "pessoa",
  mes: "mes",
  month: "mes",
  semana: "semana",
  week: "semana",
  dia: "dia",
  day: "dia",
};

function groupByDe(need: InformationNeed): QuerySpec["groupBy"] {
  const bruto = need.aggregation?.group_by?.[0] ?? (need.computation?.params?.group_by as string | undefined);
  if (!bruto) return undefined;
  return GROUP_BY[bruto];
}

function fontePrimaria(need: InformationNeed): string {
  return need.source_priority[0] ?? need.data_sources[0] ?? "transactions";
}

function computationDoNeed(need: InformationNeed): QueryPlan["computation"] {
  const tipo = need.computation?.type;
  if (!tipo) return undefined;
  if (tipo === "comparison") return { type: "diff", params: need.computation?.params };
  if (
    tipo === "diff" ||
    tipo === "pct_change" ||
    tipo === "trend" ||
    tipo === "top_n" ||
    tipo === "breakdown" ||
    tipo === "explanation"
  ) {
    return { type: tipo, params: need.computation?.params };
  }
  return undefined;
}

function fallbackSources(need: InformationNeed): string[] | undefined {
  const resto = need.source_priority.slice(1);
  return resto.length > 0 ? resto : undefined;
}

/**
 * InformationNeed → QueryPlan. Determinístico; nomes, não UUIDs inventados.
 */
export function planQuery(need: InformationNeed, context?: ConversationContext): QueryPlan {
  const tx = need.filters?.transactions;
  const primaria = fontePrimaria(need);
  const groupBy = groupByDe(need);
  const spec: QuerySpec = {};

  if (tx?.merchant) spec.merchant = tx.merchant;
  if (tx?.descricao) spec.descricao = tx.descricao;
  if (tx?.tipos?.length) spec.tipos = tx.tipos;
  if (tx?.perfil) spec.perfil = tx.perfil;
  if (tx?.origemPerfil) spec.origemPerfil = tx.origemPerfil;
  if (tx?.canal) spec.canal = tx.canal;
  if (tx?.tags?.length) spec.tags = tx.tags;
  if (tx?.contaNome) spec.contaNome = tx.contaNome;
  if (tx?.cartaoNome) spec.cartaoNome = tx.cartaoNome;
  if (tx?.categoriaNome) spec.categoriaNome = tx.categoriaNome;
  if (tx?.contaId) spec.contaId = tx.contaId;
  if (tx?.cartaoId) spec.cartaoId = tx.cartaoId;
  if (tx?.categoriaId) spec.categoriaId = tx.categoriaId;
  if (tx?.pessoaId) spec.pessoaId = tx.pessoaId;
  if (tx?.direcao) spec.direcao = tx.direcao;

  if (tx?.periodo) spec.period = tx.periodo;
  else {
    const herdado = context?.active_topic?.period ?? context?.topic_preferences?.default_period;
    if (herdado) spec.period = herdado;
  }

  if (tx?.cruzado) {
    spec.visionType = "fluxo";
    spec.entityType = "transaction";
  } else if (primaria === "accounts") {
    spec.visionType = "saldos";
    spec.entityType = "account";
    if (need.filters?.accounts?.nome) spec.contaNome = spec.contaNome ?? need.filters.accounts.nome;
  } else if (primaria === "cards") {
    spec.visionType = "cartoes";
    spec.entityType = "card";
    if (need.filters?.cards?.nome) spec.cartaoNome = spec.cartaoNome ?? need.filters.cards.nome;
  } else if (primaria === "recurrences") {
    spec.visionType = "historico";
    spec.entityType = "recurrence";
  } else if (primaria === "categories" || groupBy === "categoria") {
    spec.visionType = "categoria";
    spec.entityType = "transaction";
  } else {
    spec.visionType = "historico";
    spec.entityType = "transaction";
  }

  if (need.aggregation && need.aggregation.type !== "none") {
    spec.aggregation = need.aggregation.type;
  }
  if (groupBy) spec.groupBy = groupBy;

  if (need.expected_output === "list") {
    spec.limit = 50;
    spec.orderBy = "data";
    spec.orderDir = "desc";
  }
  if (need.computation?.type === "top_n") {
    const n = Number(need.computation.params?.n);
    spec.limit = Number.isFinite(n) && n > 0 ? Math.min(n, 500) : 5;
  }

  const baseComp = computationDoNeed(need);
  const fallback = fallbackSources(need);
  let computation: QueryPlan["computation"] = baseComp;
  if (fallback) {
    computation = {
      type: baseComp?.type ?? "none",
      params: { ...baseComp?.params, fallback_sources: fallback },
    };
  }

  return QueryPlanSchema.parse({ type: "query", spec, computation });
}

export class QueryPlanner {
  plan(need: InformationNeed, context?: ConversationContext): QueryPlan {
    return planQuery(need, context);
  }
}
