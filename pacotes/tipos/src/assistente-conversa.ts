/**
 * Contrato conversacional V3: QueryState único + DialogueAct (slot ops) + ResultContext.
 * InformationNeed/QuerySpec em assistente-v3.ts são adapter de migração, não SoT.
 */

import { z } from "zod";
import { PeriodSpecSchema, type QuerySpec } from "./assistente-v2";
import { perfilSchema } from "./cadastro";
import { tipoMovimentoSchema } from "./movimento";
import { canalPagamentoSchema, direcaoFluxoSchema } from "./relatorio";

/** Recorte estrutural de InformationNeed — evita ciclo com assistente-v3. */
type NeedParaQueryState = {
  expected_output?: string;
  aggregation?: { type?: string; group_by?: string[] };
  data_sources?: string[];
  filters?: {
    transactions?: {
      periodo?: QuerySpec["period"];
      tipos?: QuerySpec["tipos"];
      perfil?: QuerySpec["perfil"];
      origemPerfil?: QuerySpec["origemPerfil"];
      cruzado?: boolean;
      direcao?: QuerySpec["direcao"];
      merchant?: string;
      descricao?: string;
      contaId?: string;
      cartaoId?: string;
      categoriaId?: string;
      pessoaId?: string;
    };
  };
};

export const queryGrainSchema = z.enum(["summary", "list", "top", "category", "month", "explain"]);
export type QueryGrain = z.infer<typeof queryGrainSchema>;

export const entityDomainSchema = z.enum(["transactions", "accounts", "cards", "recurrences"]);
export type EntityDomain = z.infer<typeof entityDomainSchema>;

export const resultEntityTypeSchema = z.enum(["transaction", "account", "card", "category"]);
export type ResultEntityType = z.infer<typeof resultEntityTypeSchema>;

export const querySortSchema = z.object({
  by: z.enum(["valor", "data", "descricao"]),
  dir: z.enum(["asc", "desc"]),
});

export const QueryStateSchema = z
  .object({
    entityDomain: entityDomainSchema,
    grain: queryGrainSchema,
    period: PeriodSpecSchema.optional(),
    comparison: z.object({ period: PeriodSpecSchema }).optional(),
    tipos: z.array(tipoMovimentoSchema).min(1).optional(),
    tipoGasto: perfilSchema.optional(),
    origemPerfil: perfilSchema.optional(),
    cruzado: z.boolean().optional(),
    direcao: direcaoFluxoSchema.optional(),
    canal: canalPagamentoSchema.optional(),
    merchant: z.string().min(1).optional(),
    descricao: z.string().min(1).optional(),
    contaId: z.string().uuid().optional(),
    cartaoId: z.string().uuid().optional(),
    categoriaId: z.string().uuid().optional(),
    pessoaId: z.string().uuid().optional(),
    sort: querySortSchema.optional(),
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().nonnegative().optional(),
  })
  .strict();
export type QueryState = z.infer<typeof QueryStateSchema>;

export const QueryStatePartialSchema = QueryStateSchema.partial();

export const slotNameSchema = z.enum([
  "period",
  "comparison",
  "tipos",
  "tipoGasto",
  "origemPerfil",
  "cruzado",
  "direcao",
  "canal",
  "merchant",
  "descricao",
  "contaId",
  "cartaoId",
  "categoriaId",
  "pessoaId",
  "grain",
  "sort",
  "limit",
  "entityDomain",
]);
export type SlotName = z.infer<typeof slotNameSchema>;

export const SlotOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set"), slot: slotNameSchema, value: z.unknown() }),
  z.object({ op: z.literal("clear"), slot: slotNameSchema }),
]);
export type SlotOp = z.infer<typeof SlotOpSchema>;

export const ResultRefHintSchema = z.discriminatedUnion("by", [
  z.object({ by: z.literal("ordinal"), n: z.number().int().positive() }),
  z.object({
    by: z.literal("ordinal_range"),
    de: z.number().int().positive(),
    ate: z.number().int().positive(),
  }),
  z.object({ by: z.literal("amount"), value: z.number() }),
  z.object({ by: z.literal("label"), text: z.string().min(1) }),
  z.object({ by: z.literal("type"), entityType: resultEntityTypeSchema }),
]);
export type ResultRefHint = z.infer<typeof ResultRefHintSchema>;

export const diagnoseKindSchema = z.enum(["query", "data", "category", "duplicate", "unknown"]);
export type DiagnoseKind = z.infer<typeof diagnoseKindSchema>;

export const WriteIntentSchema = z.object({
  tipo: tipoMovimentoSchema.optional(),
  valor: z.number().optional(),
  descricao: z.string().min(1).optional(),
  data: z.string().optional(),
  contaNome: z.string().min(1).optional(),
  cartaoNome: z.string().min(1).optional(),
  categoriaNome: z.string().min(1).optional(),
});
export type WriteIntent = z.infer<typeof WriteIntentSchema>;

export const QueryNamesSchema = z.object({
  contaNome: z.string().min(1).optional(),
  cartaoNome: z.string().min(1).optional(),
  categoriaNome: z.string().min(1).optional(),
});
export type QueryNames = z.infer<typeof QueryNamesSchema>;

export const DialogueActSchema = z.discriminatedUnion("act", [
  z.object({ act: z.literal("greet") }),
  z.object({
    act: z.literal("new_query"),
    query: QueryStatePartialSchema,
    names: QueryNamesSchema.optional(),
  }),
  z.object({
    act: z.literal("patch_query"),
    ops: z.array(SlotOpSchema),
    names: QueryNamesSchema.optional(),
  }),
  z.object({
    act: z.literal("change_grain"),
    grain: queryGrainSchema,
    sort: querySortSchema.optional(),
    limit: z.number().int().min(1).max(500).optional(),
  }),
  z.object({ act: z.literal("refresh") }),
  z.object({ act: z.literal("refer_result"), hint: ResultRefHintSchema }),
  z.object({ act: z.literal("write"), intent: WriteIntentSchema }),
  z.object({
    act: z.literal("update"),
    target: ResultRefHintSchema.optional(),
    patch: z.record(z.unknown()),
  }),
  z.object({ act: z.literal("delete"), target: ResultRefHintSchema.optional() }),
  z.object({ act: z.literal("diagnose"), suspicion: diagnoseKindSchema.optional() }),
  z.object({ act: z.literal("confirm") }),
  z.object({ act: z.literal("cancel") }),
]);
export type DialogueAct = z.infer<typeof DialogueActSchema>;

export const ResultRowRefSchema = z.object({
  ordinal: z.number().int().positive(),
  entityType: resultEntityTypeSchema,
  entityId: z.string().uuid(),
  label: z.string().min(1),
  amount: z.number().optional(),
});
export type ResultRowRef = z.infer<typeof ResultRowRefSchema>;

export const ResultContextSchema = z.object({
  queryHash: z.string().min(1),
  generatedAt: z.number().int().positive(),
  stale: z.boolean(),
  summary: z.object({
    count: z.number().int().nonnegative(),
    total: z.number().optional(),
  }),
  rows: z.array(ResultRowRefSchema).max(50),
});
export type ResultContext = z.infer<typeof ResultContextSchema>;

const QUERY_DEFAULTS = {
  entityDomain: "transactions" as const,
  grain: "summary" as const,
};

/** Defaults só de `new_query`. Período omitido permanece omitido. */
export function estadoConsultaNovo(parcial: Partial<QueryState> = {}): QueryState {
  const limpo = omitUndefined(parcial as Record<string, unknown>);
  return QueryStateSchema.parse({
    ...limpo,
    entityDomain: parcial.entityDomain ?? QUERY_DEFAULTS.entityDomain,
    grain: parcial.grain ?? QUERY_DEFAULTS.grain,
  });
}

function omitUndefined<T extends Record<string, unknown>>(valor: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [chave, item] of Object.entries(valor)) {
    if (item !== undefined && item !== null) out[chave] = item;
  }
  return out as Partial<T>;
}

function grainDeSpec(spec: QuerySpec, need?: NeedParaQueryState): QueryGrain {
  if (spec.groupBy === "categoria" || need?.aggregation?.group_by?.includes("category")) return "category";
  if (spec.groupBy === "mes" || spec.visionType === "evolucao") return "month";
  if (spec.aggregation === "max" || spec.aggregation === "min") return "top";
  if (spec.aggregation === "sum" || spec.aggregation === "count") return "summary";
  if (need?.expected_output === "list" || need?.aggregation?.type === "none") return "list";
  if (spec.aggregation == null && spec.visionType === "historico") return "list";
  return "summary";
}

function dominioDeSpec(spec: QuerySpec, need?: NeedParaQueryState): EntityDomain {
  if (spec.entityType === "account" || spec.visionType === "saldos") return "accounts";
  if (spec.entityType === "card" || spec.visionType === "cartoes") return "cards";
  if (need?.data_sources?.includes("recurrences") && !need.data_sources.includes("transactions")) {
    return "recurrences";
  }
  return "transactions";
}

/** Adapter: last_query / QuerySpec legado → QueryState (SoT). */
export function queryStateFromSpec(spec: QuerySpec, need?: NeedParaQueryState): QueryState {
  const tx = need?.filters?.transactions;
  return QueryStateSchema.parse(
    omitUndefined({
      entityDomain: dominioDeSpec(spec, need),
      grain: grainDeSpec(spec, need),
      period: spec.period ?? tx?.periodo,
      tipos: spec.tipos ?? tx?.tipos,
      tipoGasto: spec.tipoGasto ?? spec.perfil ?? tx?.perfil,
      origemPerfil: spec.origemPerfil ?? tx?.origemPerfil,
      cruzado: spec.cruzado ?? tx?.cruzado ?? (spec.visionType === "fluxo" ? true : undefined),
      direcao: spec.direcao ?? tx?.direcao,
      canal: spec.canal,
      merchant: spec.merchant ?? tx?.merchant,
      descricao: spec.descricao ?? tx?.descricao,
      contaId: spec.contaId ?? tx?.contaId,
      cartaoId: spec.cartaoId ?? tx?.cartaoId,
      categoriaId: spec.categoriaId ?? tx?.categoriaId,
      pessoaId: spec.pessoaId ?? tx?.pessoaId,
      sort:
        spec.orderBy && spec.orderDir
          ? { by: spec.orderBy === "data" ? "data" : spec.orderBy === "valor" ? "valor" : "descricao", dir: spec.orderDir }
          : undefined,
      limit: spec.limit,
      offset: spec.offset,
    }),
  );
}

export function queryStateToSpec(query: QueryState, visao?: QuerySpec["visionType"]): QuerySpec {
  return omitUndefined({
    period: query.period,
    merchant: query.merchant,
    descricao: query.descricao,
    contaId: query.contaId,
    cartaoId: query.cartaoId,
    categoriaId: query.categoriaId,
    pessoaId: query.pessoaId,
    perfil: query.tipoGasto,
    tipoGasto: query.tipoGasto,
    origemPerfil: query.origemPerfil,
    canal: query.canal,
    cruzado: query.cruzado,
    tipos: query.tipos,
    direcao: query.direcao,
    aggregation:
      query.grain === "summary" ? "sum" : query.grain === "top" ? (query.sort?.dir === "asc" ? "min" : "max") : undefined,
    groupBy: query.grain === "category" ? "categoria" : query.grain === "month" ? "mes" : undefined,
    limit: query.limit,
    offset: query.offset,
    orderBy: query.sort?.by === "data" ? "data" : query.sort?.by === "valor" ? "valor" : query.sort?.by === "descricao" ? "descricao" : undefined,
    orderDir: query.sort?.dir,
    visionType: visao,
    entityType:
      query.entityDomain === "accounts"
        ? "account"
        : query.entityDomain === "cards"
          ? "card"
          : "transaction",
  }) as QuerySpec;
}
