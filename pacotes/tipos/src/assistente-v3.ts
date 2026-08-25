/**
 * Contratos Zod — Assistente 2.0 definitivo (ConversationUnderstanding).
 * LLM entende uma vez; Need/Plan/Context são determinísticos.
 *
 * Não substitui `assistente-v2.ts` nesta semana: o SessionManager ainda
 * persiste `ConversationState` (schemaVersion 1). Estes tipos e o adapter
 * preparam a Semana 2+.
 */

import { z } from "zod";
import {
  ConfirmationRequestSchema,
  EntityRefSchema,
  EntityReferenceSchema,
  PeriodSpecSchema,
  QuerySpecSchema,
  SimpleCommandSchema,
  UserPreferencesRefSchema,
  estadoInicialConversacao,
  normalizarConversationState,
  type ConfirmationRequest,
  type ConversationState,
  type QuerySpec,
} from "./assistente-v2";
import { perfilSchema } from "./cadastro";
import { tipoMovimentoSchema } from "./movimento";
import { direcaoFluxoSchema } from "./relatorio";
import {
  QueryStateSchema,
  ResultContextSchema,
  queryStateFromSpec,
} from "./assistente-conversa";

const nuloOu = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((valor) => (valor === undefined ? null : valor), schema.nullable());

const opcionalNulo = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((valor) => (valor === null ? undefined : valor), schema.optional());

// ============================================
// AUXILIARES
// ============================================

export const DataSourceSchema = z.enum([
  "transactions",
  "accounts",
  "cards",
  "recurrences",
  "categories",
]);
export type DataSource = z.infer<typeof DataSourceSchema>;

export const AmbiguitySchema = z.object({
  field: z.string().min(1),
  reason: z.string().min(1),
  candidates: z.array(z.unknown()).optional(),
});
export type Ambiguity = z.infer<typeof AmbiguitySchema>;

export const TransactionFiltersSchema = z.object({
  merchant: z.string().min(1).optional(),
  descricao: z.string().min(1).optional(),
  periodo: PeriodSpecSchema.optional(),
  tipos: z.array(tipoMovimentoSchema).min(1).optional(),
  contaId: z.string().uuid().optional(),
  contaNome: z.string().min(1).optional(),
  cartaoId: z.string().uuid().optional(),
  cartaoNome: z.string().min(1).optional(),
  categoriaId: z.string().uuid().optional(),
  categoriaNome: z.string().min(1).optional(),
  perfil: perfilSchema.optional(),
  /** Perfil da conta/cartão que pagou (origem do dinheiro). */
  origemPerfil: perfilSchema.optional(),
  /** Gasto pessoal em conta/cartão da empresa (ou o inverso). */
  cruzado: z.boolean().optional(),
  /** Lado do cruzado quando só um foi pedido. */
  direcao: direcaoFluxoSchema.optional(),
  /** Só cartão ou só conta. */
  canal: z.enum(["cartao", "conta"]).optional(),
  pessoaId: z.string().uuid().optional(),
  tags: z.array(z.string()).optional(),
});
export type TransactionFilters = z.infer<typeof TransactionFiltersSchema>;

export const QueryResultSummarySchema = z.object({
  count: z.number().int().nonnegative(),
  total: z.number().optional(),
  period: PeriodSpecSchema.optional(),
});
export type QueryResultSummary = z.infer<typeof QueryResultSummarySchema>;

// ============================================
// 1. CONVERSATION UNDERSTANDING (saída do LLM)
// ============================================

export const UnderstandingGoalSchema = z.enum([
  "answer",
  "execute",
  "clarify",
  "confirm",
  "greet",
  "continue",
]);
export type UnderstandingGoal = z.infer<typeof UnderstandingGoalSchema>;

export const UnderstandingIntentSchema = z.enum([
  "total",
  "list",
  "detail",
  "compare",
  "explain",
  "trend",
  "top",
  "breakdown",
  "projection",
  "create",
  "update",
  "delete",
]);
export type UnderstandingIntent = z.infer<typeof UnderstandingIntentSchema>;

export const UnderstandingEntitiesSchema = z.object({
  merchant: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  account: z.string().min(1).optional(),
  card: z.string().min(1).optional(),
  period: PeriodSpecSchema.optional(),
  metric: z.enum(["sum", "count", "avg", "max", "min", "balance", "available"]).optional(),
  computation: z
    .enum(["diff", "pct_change", "trend", "top_n", "breakdown", "explanation"])
    .optional(),
  amount: z.number().optional(),
  value: z.unknown().optional(),
});
export type UnderstandingEntities = z.infer<typeof UnderstandingEntitiesSchema>;

export const ContinuationTypeSchema = z.enum([
  "period_shift",
  "filter_add",
  "filter_remove",
  "entity_ref",
  "correction",
  "detail_request",
  "filter_modify",
]);
export type ContinuationType = z.infer<typeof ContinuationTypeSchema>;

export const ConversationUnderstandingSchema = z.object({
  goal: UnderstandingGoalSchema,
  question: z
    .object({
      intent: UnderstandingIntentSchema,
      entities: UnderstandingEntitiesSchema.optional(),
      implicit_filters: z
        .object({
          tipo: z.enum(["receita", "despesa", "transferencia"]).optional(),
          fonte: z.enum(["transacoes", "recorrencias"]).optional(),
          /** Natureza do lançamento (pessoal vs empresa), independente da conta. */
          tipoGasto: perfilSchema.optional(),
          /** Perfil da conta/cartão que pagou. "conta da empresa" → pj, não entities.account. */
          origemPerfil: perfilSchema.optional(),
        })
        .optional(),
      ambiguity: z.array(AmbiguitySchema).optional(),
    })
    .optional(),
  continuation: z
    .object({
      type: ContinuationTypeSchema,
      reference: EntityReferenceSchema,
      inherits_from_previous: z.boolean(),
    })
    .optional(),
  explicit_references: z.array(EntityReferenceSchema).optional(),
  ambiguity: z.array(AmbiguitySchema).optional(),
  confidence: z.number().min(0).max(1),
  required_sources: z.array(DataSourceSchema),
});
export type ConversationUnderstanding = z.infer<typeof ConversationUnderstandingSchema>;

// ============================================
// 2. INFORMATION NEED
// ============================================

export const InformationNeedSchema = z.object({
  data_sources: z.array(DataSourceSchema).min(1),
  filters: z
    .object({
      transactions: TransactionFiltersSchema.optional(),
      accounts: z.object({ nome: z.string().min(1).optional() }).optional(),
      cards: z.object({ nome: z.string().min(1).optional() }).optional(),
    })
    .optional(),
  aggregation: z
    .object({
      type: z.enum(["sum", "count", "avg", "max", "min", "none"]),
      field: z.string().min(1),
      group_by: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  computation: z
    .object({
      type: z.enum(["diff", "pct_change", "trend", "top_n", "breakdown", "explanation", "comparison"]),
      params: z.record(z.unknown()).optional(),
    })
    .optional(),
  expected_output: z.enum(["single_value", "list", "table", "comparison", "explanation", "chart"]),
  source_priority: z.array(z.string().min(1)).min(1),
});
export type InformationNeed = z.infer<typeof InformationNeedSchema>;

// ============================================
// 3. QUERY / COMMAND PLANS
// ============================================

export const QueryPlanSchema = z.object({
  type: z.literal("query"),
  spec: QuerySpecSchema,
  computation: z
    .object({
      type: z.enum(["none", "diff", "pct_change", "trend", "top_n", "breakdown", "explanation"]),
      params: z.record(z.unknown()).optional(),
    })
    .optional(),
});
export type QueryPlan = z.infer<typeof QueryPlanSchema>;

export const CommandPlanStepSchema = z.object({
  stepId: z.string().min(1),
  command: SimpleCommandSchema,
  description: z.string().min(1),
  dependsOn: z.array(z.string().min(1)).optional(),
});

export const CommandPlanSchema = z.object({
  type: z.literal("command"),
  steps: z.array(CommandPlanStepSchema).min(1),
});
export type CommandPlan = z.infer<typeof CommandPlanSchema>;

export const ExecutionPlanSchema = z.discriminatedUnion("type", [QueryPlanSchema, CommandPlanSchema]);
export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

// ============================================
// 4. CONVERSATION CONTEXT (schemaVersion 2)
// ============================================

export const ActiveTopicDomainSchema = z.enum([
  "spending",
  "income",
  "balance",
  "cards",
  "accounts",
  "recurrences",
  "categories",
  "budget",
]);

export const ActiveTopicSchema = z.object({
  domain: ActiveTopicDomainSchema.optional(),
  entities: z.array(EntityRefSchema).optional(),
  metric: z.enum(["sum", "count", "balance", "available", "limit"]).optional(),
  period: PeriodSpecSchema.optional(),
});
export type ActiveTopic = z.infer<typeof ActiveTopicSchema>;

export const ActiveGoalSchema = z.enum(["explore", "analyze", "execute", "correct", "configure"]);
export type ActiveGoal = z.infer<typeof ActiveGoalSchema>;

export const LastQuerySchema = z.object({
  information_need: InformationNeedSchema,
  query_spec: QuerySpecSchema,
  result_ids: z.array(z.string().uuid()),
  result_summary: QueryResultSummarySchema,
  expires_at: z.number().int().positive(),
});
export type LastQuery = z.infer<typeof LastQuerySchema>;

export const PendingActionSchema = z.object({
  type: z.enum(["confirmation", "clarification", "slot_fill"]),
  payload: z.unknown(),
});
export type PendingAction = z.infer<typeof PendingActionSchema>;

export const TopicHistoryItemSchema = z.object({
  topic: z.object({
    domain: z.string().min(1),
    entities: z.array(EntityRefSchema),
  }),
  goal: z.string().min(1),
  started_at: z.number().int().positive(),
});

export const ConversationContextSchema = z.object({
  schemaVersion: z.literal(2),
  version: z.number().int().nonnegative(),
  active_topic: nuloOu(ActiveTopicSchema),
  active_goal: nuloOu(ActiveGoalSchema),
  last_query: opcionalNulo(LastQuerySchema),
  /** SoT da consulta analítica (contrato V3). */
  query: opcionalNulo(QueryStateSchema),
  /** Ponteiros do último resultado; não é o ledger. */
  result: opcionalNulo(ResultContextSchema),
  focused_entity: nuloOu(EntityRefSchema),
  pending_action: nuloOu(PendingActionSchema),
  topic_history: z.array(TopicHistoryItemSchema).max(10),
  topic_preferences: opcionalNulo(
    z.object({
      default_period: PeriodSpecSchema.optional(),
      default_account: EntityRefSchema.optional(),
      default_card: EntityRefSchema.optional(),
    }),
  ),
  /** Preferências v1 — preservadas no adapter até o SessionManager migrar. */
  user_preferences: opcionalNulo(UserPreferencesRefSchema),
  updated_at: z.number().int().positive(),
});
export type ConversationContext = z.infer<typeof ConversationContextSchema>;

/** Default JSONB da migration 0032 — o adapter v3 tem que aceitar. */
export const CONTEXTO_SESSAO_DEFAULT_V1 = {
  schemaVersion: 1 as const,
  version: 0,
  lastResultSet: null,
  currentEntity: null,
  pendingConfirmation: null,
  explicitPeriod: null,
  userPreferencesRef: null,
};

/** Default JSONB da migration 0033 (v1 + campos v3 vazios). */
export const CONTEXTO_SESSAO_DEFAULT_MISTO = {
  schemaVersion: 1 as const,
  version: 0,
  lastResultSet: null,
  currentEntity: null,
  pendingConfirmation: null,
  explicitPeriod: null,
  userPreferencesRef: {},
  active_topic: null,
  active_goal: null,
  focused_entity: null,
  pending_action: null,
  topic_history: [] as unknown[],
  updated_at: 1,
};

export function estadoInicialConversacaoV3(agora: number = Date.now()): ConversationContext {
  const updated_at = agora > 0 ? agora : 1;
  return ConversationContextSchema.parse({
    schemaVersion: 2,
    version: 0,
    active_topic: null,
    active_goal: null,
    focused_entity: null,
    pending_action: null,
    topic_history: [],
    updated_at,
  });
}

function filtrosDeQuerySpec(spec: QuerySpec): TransactionFilters | undefined {
  const filtros: TransactionFilters = {};
  if (spec.merchant) filtros.merchant = spec.merchant;
  if (spec.descricao) filtros.descricao = spec.descricao;
  if (spec.period) filtros.periodo = spec.period;
  if (spec.tipos?.length) filtros.tipos = spec.tipos;
  if (spec.contaId) filtros.contaId = spec.contaId;
  if (spec.contaNome) filtros.contaNome = spec.contaNome;
  if (spec.cartaoId) filtros.cartaoId = spec.cartaoId;
  if (spec.cartaoNome) filtros.cartaoNome = spec.cartaoNome;
  if (spec.categoriaId) filtros.categoriaId = spec.categoriaId;
  if (spec.categoriaNome) filtros.categoriaNome = spec.categoriaNome;
  if (spec.perfil) filtros.perfil = spec.perfil;
  if (spec.tipoGasto) filtros.perfil = spec.tipoGasto;
  if (spec.origemPerfil) filtros.origemPerfil = spec.origemPerfil;
  if (spec.canal) filtros.canal = spec.canal;
  if (spec.cruzado) filtros.cruzado = true;
  if (spec.visionType === "fluxo") filtros.cruzado = true;
  if (spec.direcao) filtros.direcao = spec.direcao;
  if (spec.pessoaId) filtros.pessoaId = spec.pessoaId;
  if (spec.tags?.length) filtros.tags = spec.tags;
  return Object.keys(filtros).length > 0 ? filtros : undefined;
}

export function informationNeedDeQuerySpec(spec: QuerySpec): InformationNeed {
  const fontes: DataSource[] =
    spec.visionType === "saldos" || spec.entityType === "account"
      ? ["accounts"]
      : spec.visionType === "cartoes" || spec.entityType === "card"
        ? ["cards"]
        : ["transactions"];
  const transacoes = filtrosDeQuerySpec(spec);
  return InformationNeedSchema.parse({
    data_sources: fontes,
    filters: transacoes ? { transactions: transacoes } : undefined,
    aggregation: spec.aggregation
      ? { type: spec.aggregation, field: "valor", group_by: spec.groupBy ? [spec.groupBy] : undefined }
      : undefined,
    expected_output: spec.aggregation ? "single_value" : "list",
    source_priority: fontes,
  });
}

function lastQueryDeEstadoV1(state: ConversationState): LastQuery | undefined {
  const resultado = state.lastResultSet;
  if (!resultado) return undefined;
  return {
    information_need: informationNeedDeQuerySpec(resultado.query),
    query_spec: resultado.query,
    result_ids: resultado.ids,
    result_summary: {
      count: resultado.ids.length,
      period: resultado.query.period,
    },
    expires_at: resultado.expiresAt,
  };
}

function confirmacaoDePendingAction(acao: PendingAction | null | undefined): ConfirmationRequest | undefined {
  if (!acao || acao.type !== "confirmation") return undefined;
  const lido = ConfirmationRequestSchema.safeParse(acao.payload);
  return lido.success ? lido.data : undefined;
}

export function contextoV3DeEstadoV1(
  state: ConversationState,
  agora: number = Date.now(),
): ConversationContext {
  const last = lastQueryDeEstadoV1(state);
  const updated_at = agora > 0 ? agora : 1;
  const periodo = state.explicitPeriod;
  return ConversationContextSchema.parse({
    schemaVersion: 2,
    version: state.version,
    active_topic: periodo ? { period: periodo } : null,
    active_goal: null,
    last_query: last,
    query: last ? queryStateFromSpec(last.query_spec, last.information_need) : undefined,
    focused_entity: state.currentEntity ?? null,
    pending_action: state.pendingConfirmation
      ? { type: "confirmation" as const, payload: state.pendingConfirmation }
      : null,
    topic_history: [],
    topic_preferences: periodo ? { default_period: periodo } : undefined,
    user_preferences: state.userPreferencesRef,
    updated_at,
  });
}

export function estadoV1DeContextoV3(ctx: ConversationContext): ConversationState {
  const last = ctx.last_query;
  const confirmacao = confirmacaoDePendingAction(ctx.pending_action);
  return {
    schemaVersion: 1,
    version: ctx.version,
    lastResultSet: last
      ? { ids: last.result_ids, query: last.query_spec, expiresAt: last.expires_at }
      : undefined,
    currentEntity: ctx.focused_entity ?? undefined,
    pendingConfirmation: confirmacao,
    explicitPeriod: ctx.active_topic?.period ?? ctx.topic_preferences?.default_period,
    userPreferencesRef: ctx.user_preferences ?? {},
  };
}

function registro(bruto: unknown): Record<string, unknown> {
  if (bruto && typeof bruto === "object" && !Array.isArray(bruto)) {
    return { ...(bruto as Record<string, unknown>) };
  }
  return {};
}

function semNulos(bruto: unknown): unknown {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return bruto;
  const out: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(bruto as Record<string, unknown>)) {
    if (valor !== null) out[chave] = valor;
  }
  return out;
}

/**
 * Aceita JSON legado v1 (migration 0032) e documentos mistos v1+campos v3.
 * Sempre devolve `schemaVersion: 2` em memória — o SessionManager ainda grava v1.
 */
export function normalizarConversationContext(
  bruto: unknown,
  agora: number = Date.now(),
): ConversationContext {
  const raw = registro(bruto);
  const v1 = normalizarConversationState(raw);
  const base = contextoV3DeEstadoV1(v1, agora);

  const mesclado: Record<string, unknown> = { ...base };
  if ("active_topic" in raw) mesclado.active_topic = raw.active_topic ?? null;
  if ("active_goal" in raw) mesclado.active_goal = raw.active_goal ?? null;
  if ("last_query" in raw && raw.last_query != null) mesclado.last_query = raw.last_query;
  if ("query" in raw && raw.query != null) mesclado.query = raw.query;
  if ("result" in raw && raw.result != null) mesclado.result = raw.result;
  if ("focused_entity" in raw) mesclado.focused_entity = raw.focused_entity ?? null;
  if ("pending_action" in raw) mesclado.pending_action = raw.pending_action ?? null;
  if (Array.isArray(raw.topic_history)) mesclado.topic_history = raw.topic_history;
  if ("topic_preferences" in raw && raw.topic_preferences != null) {
    mesclado.topic_preferences = raw.topic_preferences;
  }
  if ("user_preferences" in raw && raw.user_preferences != null) {
    mesclado.user_preferences = raw.user_preferences;
  }
  if (typeof raw.updated_at === "number" && raw.updated_at > 0) {
    mesclado.updated_at = raw.updated_at;
  } else if (typeof mesclado.updated_at !== "number" || (mesclado.updated_at as number) <= 0) {
    mesclado.updated_at = agora > 0 ? agora : 1;
  }
  mesclado.schemaVersion = 2;
  mesclado.version = v1.version;

  if (mesclado.last_query != null) {
    const last = LastQuerySchema.safeParse(mesclado.last_query);
    mesclado.last_query = last.success ? last.data : undefined;
  }
  if (mesclado.query != null) {
    const query = QueryStateSchema.safeParse(semNulos(mesclado.query));
    mesclado.query = query.success ? query.data : undefined;
  }
  if (mesclado.result != null) {
    const result = ResultContextSchema.safeParse(mesclado.result);
    mesclado.result = result.success ? result.data : undefined;
  }

  if (mesclado.query == null && mesclado.last_query != null) {
    const last = LastQuerySchema.safeParse(mesclado.last_query);
    if (last.success) {
      mesclado.query = queryStateFromSpec(last.data.query_spec, last.data.information_need);
    }
  }

  return ConversationContextSchema.parse(mesclado);
}

export function estadoInicialConversacaoV1(): ConversationState {
  return estadoInicialConversacao();
}

export const AssistenteV3Schemas = {
  ConversationUnderstanding: ConversationUnderstandingSchema,
  InformationNeed: InformationNeedSchema,
  QueryPlan: QueryPlanSchema,
  CommandPlan: CommandPlanSchema,
  ExecutionPlan: ExecutionPlanSchema,
  ConversationContext: ConversationContextSchema,
} as const;
