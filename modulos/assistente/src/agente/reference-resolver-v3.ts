import { somar_dias_iso_local } from "@lancai/ia";
import { hojeISO, type ConversationContext, type EntityReference, type LastQuery, type ResolutionResult } from "@lancai/tipos";
import {
  decide,
  fuzzyMatch,
  type EntityBusca,
  type ResolverContext,
  type ResolverDeps,
} from "./reference-resolver";

export type ResolverDepsV3 = ResolverDeps;

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

function lastQueryValida(context: ConversationContext, agora: number): LastQuery | undefined {
  const last = context.last_query;
  if (!last) return undefined;
  if (last.expires_at < agora) return undefined;
  return last;
}

function entidadesDoHistorico(context: ConversationContext): EntityBusca[] {
  const ids = new Map<string, EntityBusca>();
  if (context.focused_entity) ids.set(context.focused_entity.id, context.focused_entity);
  for (const item of context.topic_history) {
    for (const ent of item.topic.entities) ids.set(ent.id, ent);
  }
  return [...ids.values()];
}

/**
 * Resolve EntityReference contra ConversationContext v3.
 * Não substitui o ReferenceResolver v1 (ConversationState).
 */
export class ReferenceResolverV3 {
  constructor(private readonly deps: ResolverDepsV3) {}

  async resolve(
    ref: EntityReference,
    context: ConversationContext,
    ctx: ResolverContext,
    agora: number = Date.now(),
  ): Promise<ResolutionResult> {
    if (ref.type === "composite") return this.resolveComposite(ref, context, ctx, agora);
    if (ref.type === "positional") return this.resolvePositional(ref, context, agora);
    if (ref.type === "temporal") return this.resolveTemporal(ref, context, ctx, agora);
    if (ref.type === "value") return this.resolveValue(ref, context, ctx, agora);
    if (ref.type === "merchant") return this.resolveMerchant(ref, context, ctx, agora);
    return this.resolveAnaphoric(ref, context, agora);
  }

  private async resolvePositional(
    ref: Extract<EntityReference, { type: "positional" }>,
    context: ConversationContext,
    agora: number,
  ): Promise<ResolutionResult> {
    const last = lastQueryValida(context, agora);
    if (!last) return { status: "not_found", reason: "Nenhuma lista anterior" };
    const offset = last.query_spec.offset ?? 0;
    const index = ref.index - 1 + offset;
    if (index < 0 || index >= last.result_ids.length) {
      return { status: "not_found", reason: `Lista tem ${last.result_ids.length} itens` };
    }
    const id = last.result_ids[index]!;
    const tipo = last.query_spec.entityType ?? "transaction";
    const entity = await this.deps.getEntityById(id, tipo);
    if (!entity) return { status: "not_found", reason: "Entidade não encontrada" };
    return { status: "resolved", entity: { entity, confidence: 1, method: "positional" } };
  }

  private async resolveTemporal(
    ref: Extract<EntityReference, { type: "temporal" }>,
    context: ConversationContext,
    ctx: ResolverContext,
    agora: number,
  ): Promise<ResolutionResult> {
    const currentDate = ctx.currentDate ?? hojeISO();
    const alvo = parseTemporalRelative(ref.relative, currentDate);
    const last = lastQueryValida(context, agora);
    if (last) {
      const entities = await this.deps.getEntitiesByIds(last.result_ids);
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
    context: ConversationContext,
    ctx: ResolverContext,
    agora: number,
  ): Promise<ResolutionResult> {
    const last = lastQueryValida(context, agora);
    if (last) {
      const entities = await this.deps.getEntitiesByIds(last.result_ids);
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
    context: ConversationContext,
    ctx: ResolverContext,
    agora: number,
  ): Promise<ResolutionResult> {
    const merchant = ref.name;
    const casar = (e: EntityBusca) => fuzzyMatch(String(e.metadata?.merchant ?? e.label), merchant) >= 0.7;

    const last = lastQueryValida(context, agora);
    if (last) {
      const entities = await this.deps.getEntitiesByIds(last.result_ids);
      const matches = entities.filter(casar).map((e) => ({
        ...e,
        metadata: {
          ...e.metadata,
          matchExato: String(e.metadata?.merchant ?? "").toLocaleLowerCase("pt-BR") === merchant.toLocaleLowerCase("pt-BR"),
        },
      }));
      const resultado = decide(matches, "merchant");
      if (resultado.status !== "not_found") return resultado;
    }

    if (context.focused_entity && casar(context.focused_entity)) {
      return {
        status: "resolved",
        entity: { entity: context.focused_entity, confidence: 0.85, method: "merchant" },
      };
    }

    const recentes = entidadesDoHistorico(context).filter(casar);
    const doHistorico = decide(recentes, "merchant");
    if (doHistorico.status !== "not_found") return doHistorico;

    return decide(
      await this.deps.searchEntities({ userId: ctx.usuarioId, merchant, limit: 20 }),
      "merchant",
    );
  }

  private async resolveAnaphoric(
    ref: Extract<EntityReference, { type: "anaphoric" }>,
    context: ConversationContext,
    agora: number,
  ): Promise<ResolutionResult> {
    if (context.focused_entity) {
      return {
        status: "resolved",
        entity: { entity: context.focused_entity, confidence: 0.9, method: "anaphoric" },
      };
    }
    const last = lastQueryValida(context, agora);
    if (last && last.result_ids.length > 0) {
      const id =
        ref.pronoun === "previous" || ref.pronoun === "last"
          ? last.result_ids[last.result_ids.length - 1]
          : last.result_ids[0];
      const entity = await this.deps.getEntityById(id!, last.query_spec.entityType ?? "transaction");
      if (entity) {
        return { status: "resolved", entity: { entity, confidence: 0.7, method: "anaphoric" } };
      }
    }
    const recentes = entidadesDoHistorico(context);
    if (recentes.length > 0) {
      const escolhida =
        ref.pronoun === "previous" || ref.pronoun === "last" ? recentes[recentes.length - 1] : recentes[0];
      return {
        status: "resolved",
        entity: { entity: escolhida!, confidence: 0.6, method: "anaphoric" },
      };
    }
    return { status: "not_found", reason: "Nenhuma entidade anterior" };
  }

  private async resolveComposite(
    ref: Extract<EntityReference, { type: "composite" }>,
    context: ConversationContext,
    ctx: ResolverContext,
    agora: number,
  ): Promise<ResolutionResult> {
    const resultados = await Promise.all(ref.parts.map((p) => this.resolve(p, context, ctx, agora)));
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

export async function resolveReferenceV3(
  ref: EntityReference,
  deps: ResolverDepsV3,
  context: ConversationContext,
  ctx: ResolverContext,
  agora?: number,
): Promise<ResolutionResult> {
  return new ReferenceResolverV3(deps).resolve(ref, context, ctx, agora);
}
