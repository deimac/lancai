/**
 * Contratos Zod/TypeScript — Assistente 2.0
 * Contrato canônico interno entre Parser, Resolver, Policy, Executor
 */

import { z } from "zod";

// ============================================
// ENTITY REFERENCE (Parser → Resolver)
// ============================================

export type EntityReference =
  | { type: "positional"; index: number }
  | { type: "temporal"; relative: "today" | "yesterday" | "last_week" | "this_month" | "last_month" | string }
  | { type: "value"; amount: number }
  | { type: "merchant"; name: string }
  | { type: "anaphoric"; pronoun: "that" | "last" | "previous" }
  | { type: "composite"; parts: EntityReference[] };

export const EntityReferenceSchema: z.ZodType<EntityReference> = z.lazy(() =>
  z.union([
    z.object({ type: z.literal("positional"), index: z.number().int().positive() }),
    z.object({
      type: z.literal("temporal"),
      relative: z.enum(["today", "yesterday", "last_week", "this_month", "last_month"]).or(z.string()),
    }),
    z.object({ type: z.literal("value"), amount: z.number() }),
    z.object({ type: z.literal("merchant"), name: z.string().min(1) }),
    z.object({ type: z.literal("anaphoric"), pronoun: z.enum(["that", "last", "previous"]) }),
    z.object({ type: z.literal("composite"), parts: z.array(EntityReferenceSchema) }),
  ]),
);

// ============================================
// USER REQUEST (Contrato Canônico)
// ============================================

export const TransactionParamsSchema = z.object({
  tipo: z.enum(["receita", "despesa", "transferencia", "reembolso", "emprestimo", "estorno", "retirada", "aporte"]).optional(),
  valor: z.number().positive().optional(),
  dataMovimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  descricao: z.string().min(1).max(500).optional(),
  contaId: z.string().uuid().optional(),
  cartaoId: z.string().uuid().optional(),
  contaDestinoId: z.string().uuid().optional(),
  categoriaId: z.string().uuid().optional(),
  pessoaId: z.string().uuid().optional(),
  perfil: z.enum(["pf", "pj"]).optional(),
  formaPagamento: z.enum(["pix", "credito", "debito", "dinheiro", "transferencia", "boleto", "ted", "doc", "outro"]).optional(),
  parcelamento: z.object({
    numero: z.number().int().positive(),
    total: z.number().int().positive(),
    valorTotal: z.number().positive().optional(),
    compraEm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).optional(),
});

export const RecurrenceParamsSchema = z.object({
  descricao: z.string().min(1).max(500),
  valor: z.number().positive(),
  diaDoMes: z.number().int().min(1).max(31),
  contaId: z.string().uuid().optional(),
  cartaoId: z.string().uuid().optional(),
  categoriaId: z.string().uuid().optional(),
  perfil: z.enum(["pf", "pj"]).optional(),
});

export const RuleParamsSchema = z.object({
  merchant: z.string().min(1).max(200),
  categoriaId: z.string().uuid(),
  perfil: z.enum(["pf", "pj"]).optional(),
  contaId: z.string().uuid().optional(),
  cartaoId: z.string().uuid().optional(),
});

export const QuerySpecSchema = z.object({
  period: z.object({
    tipo: z.enum(["mes_atual", "mes_passado", "ultimos_n_meses", "ano_atual", "personalizado"]),
    de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    nMeses: z.number().int().positive().optional(),
  }).optional(),
  categoriaId: z.string().uuid().optional(),
  categoriaNome: z.string().optional(),
  merchant: z.string().optional(),
  descricao: z.string().optional(),
  contaId: z.string().uuid().optional(),
  contaNome: z.string().optional(),
  cartaoId: z.string().uuid().optional(),
  cartaoNome: z.string().optional(),
  perfil: z.enum(["pf", "pj"]).optional(),
  pessoaId: z.string().uuid().optional(),
  tags: z.array(z.string()).optional(),
  tipos: z.array(z.enum(["receita", "despesa", "transferencia", "reembolso", "emprestimo", "estorno", "retirada", "aporte"])).optional(),
  aggregation: z.enum(["sum", "count", "avg", "max", "min"]).optional(),
  groupBy: z.enum(["categoria", "merchant", "conta", "cartao", "perfil", "pessoa", "mes", "semana", "dia"]).optional(),
  limit: z.number().int().positive().max(500).optional(),
  offset: z.number().int().nonnegative().optional(),
  orderBy: z.enum(["data", "valor", "descricao"]).optional(),
  orderDir: z.enum(["asc", "desc"]).optional(),
  visionType: z.enum(["saldos", "cartoes", "parcelamentos", "categoria", "futuro", "fluxo", "evolucao", "historico"]).optional(),
  entityType: z.enum(["transaction", "account", "card", "recurrence", "rule", "category"]).optional(),
});

export type QuerySpec = z.infer<typeof QuerySpecSchema>;

export const ReferencesSchema = z.object({
  target: z.lazy(() => EntityReferenceSchema).optional(),
  account: z.lazy(() => EntityReferenceSchema).optional(),
  card: z.lazy(() => EntityReferenceSchema).optional(),
  category: z.lazy(() => EntityReferenceSchema).optional(),
}).optional();

export const UserRequestMetaSchema = z.object({
  source: z.enum(["shortcut", "llm", "multimodal"]),
  confidence: z.number().min(0).max(1),
});

export const UserRequestSchema = z.object({
  op: z.enum(["create", "update", "delete", "query", "classify"]),
  resource: z.enum(["transaction", "recurrence", "rule", "account", "card"]),
  /**
   * Params são validados no handler certo (union Zod comeria campos de QuerySpec
   * porque TransactionParams é todo opcional e casa primeiro).
   */
  params: z.record(z.unknown()),
  references: ReferencesSchema,
  meta: UserRequestMetaSchema.optional(),
});

export type UserRequest = Omit<z.infer<typeof UserRequestSchema>, "params"> & {
  params: z.infer<typeof TransactionParamsSchema> &
    Partial<z.infer<typeof RecurrenceParamsSchema>> &
    Partial<z.infer<typeof RuleParamsSchema>> &
    Partial<z.infer<typeof QuerySpecSchema>> &
    Record<string, unknown>;
};

// ============================================
// RESOLVED REQUEST (Parser + Resolver)
// ============================================

export const EntityRefSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["transaction", "account", "card", "recurrence", "rule", "category"]),
  label: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

export type EntityRef = z.infer<typeof EntityRefSchema>;

export const ResolvedReferencesSchema = z.object({
  target: EntityRefSchema.optional(),
  account: EntityRefSchema.optional(),
  card: EntityRefSchema.optional(),
  category: EntityRefSchema.optional(),
});

export const SemanticConfidenceSchema = z.number().min(0).max(1);

export const ResolvedRequestSchema = z.object({
  request: UserRequestSchema,
  resolved: ResolvedReferencesSchema,
  semanticConfidence: SemanticConfidenceSchema,
});

export type ResolvedRequest = z.infer<typeof ResolvedRequestSchema>;

// ============================================
// CONVERSATION STATE
// ============================================

export const PeriodSpecSchema = z.object({
  tipo: z.enum(["mes_atual", "mes_passado", "ultimos_n_meses", "ano_atual", "personalizado"]),
  de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  nMeses: z.number().int().positive().optional(),
});

export type PeriodSpec = z.infer<typeof PeriodSpecSchema>;

export const ConfirmationRequestSchema = z.object({
  confirmationId: z.string().uuid(),
  requestHash: z.string(),
  stateVersion: z.number().int().nonnegative(),
  message: z.string(),
  options: z.array(z.string()),
  expiresAt: z.number().int().positive(),
  /** ResolvedRequest serializado para executar após o "sim". */
  payload: z.unknown().optional(),
});

export type ConfirmationRequest = z.infer<typeof ConfirmationRequestSchema>;

export const UserPreferencesRefSchema = z.object({
  defaultAccountId: z.string().uuid().optional(),
  defaultCardId: z.string().uuid().optional(),
  defaultProfile: z.enum(["pf", "pj"]).optional(),
  defaultWorkspaceId: z.string().uuid().optional(),
  merchantRules: z.record(z.string()).optional(),
  merchantProfileRules: z.record(z.enum(["pf", "pj"])).optional(),
});

export type UserPreferencesRef = z.infer<typeof UserPreferencesRefSchema>;

export const ResultSetRefSchema = z.object({
  ids: z.array(z.string().uuid()),
  query: QuerySpecSchema,
  expiresAt: z.number().int().positive(),
});

export type ResultSetRef = z.infer<typeof ResultSetRefSchema>;

const opcionalJson = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((valor) => (valor === null ? undefined : valor), schema.optional());

export const ConversationStateSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.number().int().nonnegative(),
  lastResultSet: opcionalJson(ResultSetRefSchema),
  currentEntity: opcionalJson(EntityRefSchema),
  pendingConfirmation: opcionalJson(ConfirmationRequestSchema),
  explicitPeriod: opcionalJson(PeriodSpecSchema),
  userPreferencesRef: opcionalJson(UserPreferencesRefSchema).default({}),
});

export type ConversationState = z.infer<typeof ConversationStateSchema>;

/** Estado vazio de uma sessão nova (version 0, sem referências). */
export function estadoInicialConversacao(): ConversationState {
  return {
    schemaVersion: 1,
    version: 0,
    userPreferencesRef: {},
  };
}

/** JSONB pode trazer `null` nos campos opcionais — o Zod optional não aceita null. */
export function normalizarConversationState(bruto: unknown): ConversationState {
  const obj =
    bruto && typeof bruto === "object" && !Array.isArray(bruto)
      ? { ...(bruto as Record<string, unknown>) }
      : {};
  for (const chave of [
    "lastResultSet",
    "currentEntity",
    "pendingConfirmation",
    "explicitPeriod",
    "userPreferencesRef",
  ] as const) {
    if (obj[chave] === null) delete obj[chave];
  }
  if (obj.schemaVersion !== 1) obj.schemaVersion = 1;
  if (typeof obj.version !== "number" || !Number.isFinite(obj.version) || obj.version < 0) {
    obj.version = 0;
  }
  if (!obj.userPreferencesRef || typeof obj.userPreferencesRef !== "object") {
    obj.userPreferencesRef = {};
  }
  return ConversationStateSchema.parse(obj);
}

// ============================================
// POLICY
// ============================================

export const RiskLevelSchema = z.enum(["none", "confirmation_required", "blocked"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const PolicyDecisionSchema = z.object({
  allowed: z.boolean(),
  risk: RiskLevelSchema,
  confirm: z.boolean(),
  reason: z.enum(["risk", "of_fato_immutable", "of_cannot_delete", "ambiguity", "auto"]),
  message: z.string().optional(),
});

export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

// ============================================
// COMMANDS (Atômicos)
// ============================================

export const CreateTransactionInputSchema = TransactionParamsSchema.extend({
  // Validação conta XOR cartão feita no handler
});

export const UpdateTransactionInputSchema = z.object({
  movementId: z.string().uuid(),
  fatoPatch: z.object({
    valor: z.number().optional(),
    dataMovimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    contaId: z.string().uuid().nullable().optional(),
    cartaoId: z.string().uuid().nullable().optional(),
    tipo: z.enum(["receita", "despesa", "transferencia", "reembolso", "emprestimo", "estorno", "retirada", "aporte"]).optional(),
    descricaoFonte: z.string().optional(),
    formaPagamento: z.enum(["pix", "credito", "debito", "dinheiro", "transferencia", "boleto", "ted", "doc", "outro"]).optional(),
    parcelamento: z.object({
      numero: z.number().int().positive(),
      total: z.number().int().positive(),
      valorTotal: z.number().positive().optional(),
      compraEm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).optional(),
  }).optional(),
  conhecimentoPatch: z.object({
    categoriaId: z.string().uuid().nullable().optional(),
    pessoaId: z.string().uuid().nullable().optional(),
    perfil: z.enum(["pf", "pj"]).optional(),
    tags: z.array(z.string()).optional(),
    observacoes: z.string().nullable().optional(),
    ignoradoEmRelatorio: z.boolean().optional(),
  }).optional(),
}).refine(data => data.fatoPatch || data.conhecimentoPatch, { message: "Pelo menos um patch obrigatório" });

export const CancelTransactionInputSchema = z.object({
  movementId: z.string().uuid(),
});

export const QueryTransactionsInputSchema = z.object({
  spec: QuerySpecSchema,
});

export const CreateRecurrenceInputSchema = RecurrenceParamsSchema;

export const CreateRuleInputSchema = RuleParamsSchema;

export const SimpleCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create_transaction"), input: CreateTransactionInputSchema }),
  z.object({ type: z.literal("update_transaction"), input: UpdateTransactionInputSchema }),
  z.object({ type: z.literal("cancel_transaction"), input: CancelTransactionInputSchema }),
  z.object({ type: z.literal("query_transactions"), spec: QuerySpecSchema }),
  z.object({ type: z.literal("create_recurrence"), input: CreateRecurrenceInputSchema }),
  z.object({ type: z.literal("create_rule"), input: CreateRuleInputSchema }),
]);

export type SimpleCommand = z.infer<typeof SimpleCommandSchema>;

// ============================================
// COMMAND CONTEXT & RESULT
// ============================================

export const CommandContextSchema = z.object({
  authenticatedUserId: z.string().uuid(),
  sessionId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  traceId: z.string(),
  stateVersion: z.number().int().nonnegative(),
});

export type CommandContext = z.infer<typeof CommandContextSchema>;

export const CommandResultSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
  entityRef: EntityRefSchema.optional(),
  idempotent: z.boolean().optional(),
});

export type CommandResult = z.infer<typeof CommandResultSchema>;

// ============================================
// PARSER TYPES
// ============================================

export const ParserInputSchema = z.object({
  mensagem: z.string(),
  state: ConversationStateSchema,
  userId: z.string().uuid(),
  canal: z.enum(["web", "whatsapp"]),
  intencaoPrevia: z.record(z.unknown()).optional(),
});

export type ParserInput = z.infer<typeof ParserInputSchema>;

export const ParseResultSchema = z.object({
  request: UserRequestSchema,
  usedShortcut: z.boolean(),
  shortcutName: z.string().optional(),
  warnings: z.array(z.string()),
});

export type ParseResult = z.infer<typeof ParseResultSchema>;

// ============================================
// RESOLVER TYPES
// ============================================

export const ResolvedEntitySchema = z.object({
  entity: EntityRefSchema,
  confidence: z.number().min(0).max(1),
  method: z.enum(["exact", "positional", "temporal", "value", "merchant", "anaphoric", "composite"]),
});

export type ResolvedEntity = z.infer<typeof ResolvedEntitySchema>;

export const ResolutionResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("resolved"), entity: ResolvedEntitySchema }),
  z.object({ status: z.literal("ambiguous"), candidates: z.array(ResolvedEntitySchema) }),
  z.object({ status: z.literal("not_found"), reason: z.string() }),
]);

export type ResolutionResult = z.infer<typeof ResolutionResultSchema>;

export const ResolverDepsSchema = z.object({
  getEntityById: z.function().args(z.string(), z.string()).returns(z.promise(z.unknown())),
  getEntitiesByIds: z.function().args(z.array(z.string())).returns(z.promise(z.array(z.unknown()))),
  searchEntities: z.function().args(z.record(z.unknown())).returns(z.promise(z.array(z.unknown()))),
});

export type ResolverDeps = z.infer<typeof ResolverDepsSchema>;

// ============================================
// EXPORTS AGRUPADOS
// ============================================

export const AssistenteV2Schemas = {
  EntityReference: EntityReferenceSchema,
  UserRequest: UserRequestSchema,
  ResolvedRequest: ResolvedRequestSchema,
  ConversationState: ConversationStateSchema,
  PolicyDecision: PolicyDecisionSchema,
  SimpleCommand: SimpleCommandSchema,
  CommandContext: CommandContextSchema,
  CommandResult: CommandResultSchema,
  ParserInput: ParserInputSchema,
  ParseResult: ParseResultSchema,
  ResolutionResult: ResolutionResultSchema,
} as const;