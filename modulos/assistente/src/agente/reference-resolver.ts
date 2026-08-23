import { somar_dias_iso_local } from "@lancai/ia";
import { hojeISO } from "@lancai/tipos";
import type {
  ConversationState,
  EntityRef,
  EntityReference,
  ResolutionResult,
  ResolvedEntity,
  ResolvedRequest,
  UserRequest,
} from "@lancai/tipos";

export type SearchCriteria = {
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
  valor?: number;
  merchant?: string;
  limit?: number;
};

export type EntityBusca = EntityRef;

export interface ResolverDeps {
  getEntityById(id: string, type: string): Promise<EntityBusca | null>;
  getEntitiesByIds(ids: string[]): Promise<EntityBusca[]>;
  searchEntities(criteria: SearchCriteria): Promise<EntityBusca[]>;
}

export type ResolverContext = {
  usuarioId: string;
  currentDate?: string;
};

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

function distanciaLevenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + custo);
    }
  }
  return dp[m]![n]!;
}

/** Similaridade 0–1 entre nomes de merchant. */
export function fuzzyMatch(a: string, b: string): number {
  const x = normalizar(a);
  const y = normalizar(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.9;
  const max = Math.max(x.length, y.length);
  return Math.max(0, 1 - distanciaLevenshtein(x, y) / max);
}

function parseTemporalRelative(relative: string, currentDate: string): string {
  const r = relative.toLocaleLowerCase("pt-BR");
  if (r === "today" || r === "hoje") return currentDate;
  if (r === "yesterday" || r === "ontem") return somar_dias_iso_local(currentDate, -1);
  if (r === "last_week" || /semana/.test(r)) return somar_dias_iso_local(currentDate, -7);
  if (r === "this_month" || /este\s+m/.test(r)) return currentDate.slice(0, 7);
  if (r === "last_month" || /m[eê]s\s+passado/.test(r)) {
    const [ano, mes] = currentDate.split("-").map(Number);
    const d = new Date(Date.UTC(ano!, mes! - 2, 1));
    return d.toISOString().slice(0, 7);
  }
  return relative;
}

function mesmoPeriodo(dataMovimento: unknown, alvo: string): boolean {
  if (typeof dataMovimento !== "string") return false;
  if (alvo.length === 7) return dataMovimento.startsWith(alvo);
  return dataMovimento.slice(0, 10) === alvo.slice(0, 10);
}

function score(entity: EntityBusca, now = Date.now()): number {
  const recencia = typeof entity.metadata?.dataMovimento === "string"
    ? new Date(`${entity.metadata.dataMovimento}T12:00:00Z`).getTime()
    : 0;
  const recenciaNorm = recencia > 0 ? Math.min(1, recencia / now) : 0.5;
  const exact = entity.metadata?.matchExato === true ? 0.2 : 0;
  return recenciaNorm + exact;
}

function toRef(entity: EntityBusca): EntityRef {
  return {
    id: entity.id,
    type: entity.type,
    label: entity.label,
    metadata: entity.metadata,
  };
}

/**
 * Política de ambiguidade: 0 → not_found; 1 → resolved; vários com gap ≥ 0.3 → top; senão top 3.
 */
export function decide(
  entities: EntityBusca[],
  method: ResolvedEntity["method"],
): ResolutionResult {
  if (entities.length === 0) return { status: "not_found", reason: "Nenhum candidato" };
  if (entities.length === 1) {
    return {
      status: "resolved",
      entity: { entity: toRef(entities[0]!), confidence: 0.9, method },
    };
  }
  const sorted = [...entities].sort((a, b) => score(b) - score(a));
  const top = sorted[0]!;
  const second = sorted[1]!;
  if (score(top) - score(second) >= 0.3) {
    return { status: "resolved", entity: { entity: toRef(top), confidence: 0.75, method } };
  }
  return {
    status: "ambiguous",
    candidates: sorted.slice(0, 3).map((e) => ({ entity: toRef(e), confidence: score(e), method })),
  };
}

function lastResultSetValido(state: ConversationState): ConversationState["lastResultSet"] {
  if (!state.lastResultSet) return undefined;
  if (state.lastResultSet.expiresAt < Date.now()) return undefined;
  return state.lastResultSet;
}

/**
 * Resolve EntityReference → EntityRef. Pipeline determinístico, sem LLM.
 */
export class ReferenceResolver {
  constructor(private readonly deps: ResolverDeps) {}

  async resolve(
    ref: EntityReference,
    state: ConversationState,
    ctx: ResolverContext,
  ): Promise<ResolutionResult> {
    if (ref.type === "composite") return this.resolveComposite(ref, state, ctx);
    if (ref.type === "positional") return this.resolvePositional(ref, state);
    if (ref.type === "temporal") return this.resolveTemporal(ref, state, ctx);
    if (ref.type === "value") return this.resolveValue(ref, state, ctx);
    if (ref.type === "merchant") return this.resolveMerchant(ref, state, ctx);
    return this.resolveAnaphoric(ref, state);
  }

  async resolveRequest(
    request: UserRequest,
    state: ConversationState,
    ctx: ResolverContext,
  ): Promise<ResolvedRequest> {
    const resolved: ResolvedRequest["resolved"] = {};
    const refs = request.references;
    if (refs?.target) {
      const r = await this.resolve(refs.target, state, ctx);
      if (r.status === "resolved") resolved.target = r.entity.entity;
      if (r.status === "ambiguous") {
        resolved.target = {
          id: "00000000-0000-4000-8000-000000000000",
          type: "transaction",
          label: "ambíguo",
          metadata: { candidates: r.candidates, status: "ambiguous" },
        };
      }
    } else if (
      (request.op === "update" || request.op === "delete" || request.op === "classify") &&
      state.currentEntity
    ) {
      resolved.target = state.currentEntity;
    }
    if (refs?.account) {
      const r = await this.resolve(refs.account, state, ctx);
      if (r.status === "resolved") resolved.account = r.entity.entity;
    }
    if (refs?.card) {
      const r = await this.resolve(refs.card, state, ctx);
      if (r.status === "resolved") resolved.card = r.entity.entity;
    }
    if (refs?.category) {
      const r = await this.resolve(refs.category, state, ctx);
      if (r.status === "resolved") resolved.category = r.entity.entity;
    }
    return {
      request,
      resolved,
      semanticConfidence: request.meta?.confidence ?? 0.8,
    };
  }

  private async resolvePositional(
    ref: Extract<EntityReference, { type: "positional" }>,
    state: ConversationState,
  ): Promise<ResolutionResult> {
    const set = lastResultSetValido(state);
    if (!set) return { status: "not_found", reason: "Nenhuma lista anterior" };
    const offset = set.query.offset ?? 0;
    const index = ref.index - 1 + offset;
    if (index < 0 || index >= set.ids.length) {
      return { status: "not_found", reason: `Lista tem ${set.ids.length} itens` };
    }
    const id = set.ids[index]!;
    const tipo = set.query.entityType ?? "transaction";
    const entity = await this.deps.getEntityById(id, tipo);
    if (!entity) return { status: "not_found", reason: "Entidade não encontrada" };
    return { status: "resolved", entity: { entity, confidence: 1, method: "positional" } };
  }

  private async resolveTemporal(
    ref: Extract<EntityReference, { type: "temporal" }>,
    state: ConversationState,
    ctx: ResolverContext,
  ): Promise<ResolutionResult> {
    const currentDate = ctx.currentDate ?? hojeISO();
    const alvo = parseTemporalRelative(ref.relative, currentDate);
    const set = lastResultSetValido(state);
    if (set) {
      const entities = await this.deps.getEntitiesByIds(set.ids);
      const matches = entities.filter((e) => mesmoPeriodo(e.metadata?.dataMovimento, alvo));
      const resultado = decide(matches, "temporal");
      if (resultado.status !== "not_found") return resultado;
    }
    const dateFrom = alvo.length === 7 ? `${alvo}-01` : alvo;
    const dateTo = alvo.length === 7 ? `${alvo}-31` : alvo;
    const entities = await this.deps.searchEntities({
      userId: ctx.usuarioId,
      dateFrom,
      dateTo,
      limit: 20,
    });
    return decide(entities, "temporal");
  }

  private async resolveValue(
    ref: Extract<EntityReference, { type: "value" }>,
    state: ConversationState,
    ctx: ResolverContext,
  ): Promise<ResolutionResult> {
    const set = lastResultSetValido(state);
    if (set) {
      const entities = await this.deps.getEntitiesByIds(set.ids);
      const matches = entities.filter((e) => Number(e.metadata?.valor) === ref.amount);
      const resultado = decide(matches, "value");
      if (resultado.status !== "not_found") return resultado;
    }
    return decide(
      await this.deps.searchEntities({ userId: ctx.usuarioId, valor: ref.amount, limit: 20 }),
      "value",
    );
  }

  private async resolveMerchant(
    ref: Extract<EntityReference, { type: "merchant" }>,
    state: ConversationState,
    ctx: ResolverContext,
  ): Promise<ResolutionResult> {
    const merchant = normalizar(ref.name);
    const casar = (e: EntityBusca) =>
      fuzzyMatch(String(e.metadata?.merchant ?? e.label), merchant) >= 0.7;

    const set = lastResultSetValido(state);
    if (set) {
      const entities = await this.deps.getEntitiesByIds(set.ids);
      const matches = entities.filter(casar).map((e) => ({
        ...e,
        metadata: {
          ...e.metadata,
          matchExato: normalizar(String(e.metadata?.merchant ?? "")) === merchant,
        },
      }));
      const resultado = decide(matches, "merchant");
      if (resultado.status !== "not_found") return resultado;
    }

    if (state.currentEntity && casar(state.currentEntity)) {
      return {
        status: "resolved",
        entity: { entity: state.currentEntity, confidence: 0.85, method: "merchant" },
      };
    }

    return decide(
      await this.deps.searchEntities({ userId: ctx.usuarioId, merchant, limit: 20 }),
      "merchant",
    );
  }

  private async resolveAnaphoric(
    ref: Extract<EntityReference, { type: "anaphoric" }>,
    state: ConversationState,
  ): Promise<ResolutionResult> {
    if (state.currentEntity) {
      return {
        status: "resolved",
        entity: { entity: state.currentEntity, confidence: 0.9, method: "anaphoric" },
      };
    }
    const set = lastResultSetValido(state);
    if (set && set.ids.length > 0) {
      const id = ref.pronoun === "previous" || ref.pronoun === "last" ? set.ids[set.ids.length - 1] : set.ids[0];
      const entity = await this.deps.getEntityById(id!, set.query.entityType ?? "transaction");
      if (entity) {
        return { status: "resolved", entity: { entity, confidence: 0.7, method: "anaphoric" } };
      }
    }
    return { status: "not_found", reason: "Nenhuma entidade anterior" };
  }

  private async resolveComposite(
    ref: Extract<EntityReference, { type: "composite" }>,
    state: ConversationState,
    ctx: ResolverContext,
  ): Promise<ResolutionResult> {
    const resultados = await Promise.all(ref.parts.map((p) => this.resolve(p, state, ctx)));
    const conjuntos: Set<string>[] = [];
    for (const r of resultados) {
      if (r.status === "resolved") conjuntos.push(new Set([r.entity.entity.id]));
      else if (r.status === "ambiguous") conjuntos.push(new Set(r.candidates.map((c) => c.entity.id)));
      else conjuntos.push(new Set());
    }
    if (conjuntos.length === 0) return { status: "not_found", reason: "Composto vazio" };
    const intersecao = conjuntos.reduce((acc, set) => new Set([...acc].filter((x) => set.has(x))));
    if (intersecao.size === 1) {
      const id = [...intersecao][0]!;
      const entity = await this.deps.getEntityById(id, "transaction");
      if (!entity) return { status: "not_found", reason: "Entidade não encontrada" };
      return { status: "resolved", entity: { entity, confidence: 0.95, method: "composite" } };
    }
    if (intersecao.size > 1) {
      const entities = (
        await Promise.all([...intersecao].map((id) => this.deps.getEntityById(id, "transaction")))
      ).filter((e): e is EntityBusca => Boolean(e));
      return {
        status: "ambiguous",
        candidates: entities.map((e) => ({ entity: e, confidence: 0.7, method: "composite" as const })),
      };
    }
    return { status: "not_found", reason: "Nenhuma entidade corresponde a todos os critérios" };
  }
}
