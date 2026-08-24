import { describe, expect, it, vi } from "vitest";
import {
  ConversationContextSchema,
  estadoInicialConversacaoV3,
  type ConversationContext,
  type EntityRef,
} from "@lancai/tipos";
import type { EntityBusca, ResolverDeps } from "../agente/reference-resolver";
import { ReferenceResolverV3, resolveReferenceV3 } from "../agente/reference-resolver-v3";

const USER = "00000000-0000-4000-8000-000000000001";
const AGORA = 1_777_000_000_000;
const MOV = {
  a: "00000000-0000-4000-8000-000000000101",
  b: "00000000-0000-4000-8000-000000000102",
  c: "00000000-0000-4000-8000-000000000103",
};

function ent(id: string, extra: Partial<EntityBusca> = {}): EntityBusca {
  return {
    id,
    type: "transaction",
    label: extra.label ?? id,
    metadata: extra.metadata,
  };
}

function criarDeps(entidades: EntityBusca[]): ResolverDeps {
  const porId = new Map(entidades.map((e) => [e.id, e]));
  return {
    getEntityById: vi.fn(async (id: string) => porId.get(id) ?? null),
    getEntitiesByIds: vi.fn(async (ids: string[]) =>
      ids.map((id) => porId.get(id)).filter((e): e is EntityBusca => Boolean(e)),
    ),
    searchEntities: vi.fn(async () => entidades),
  };
}

function contextoComLista(
  ids: string[],
  extra: Partial<ConversationContext> = {},
  queryExtra: Record<string, unknown> = {},
): ConversationContext {
  return ConversationContextSchema.parse({
    ...estadoInicialConversacaoV3(AGORA),
    last_query: {
      information_need: {
        data_sources: ["transactions"],
        source_priority: ["transactions"],
        expected_output: "list",
      },
      query_spec: { entityType: "transaction", ...queryExtra },
      result_ids: ids,
      result_summary: { count: ids.length },
      expires_at: AGORA + 600_000,
    },
    ...extra,
  });
}

describe("ReferenceResolverV3", () => {
  const ctx = { usuarioId: USER, currentDate: "2026-08-23" };

  it("positional: o segundo", async () => {
    const deps = criarDeps([ent(MOV.a), ent(MOV.b), ent(MOV.c)]);
    const r = await new ReferenceResolverV3(deps).resolve(
      { type: "positional", index: 2 },
      contextoComLista([MOV.a, MOV.b, MOV.c]),
      ctx,
      AGORA,
    );
    expect(r.status).toBe("resolved");
    if (r.status === "resolved") expect(r.entity.entity.id).toBe(MOV.b);
  });

  it("positional: offset da query_spec", async () => {
    const deps = criarDeps([ent(MOV.a), ent(MOV.b), ent(MOV.c)]);
    const r = await new ReferenceResolverV3(deps).resolve(
      { type: "positional", index: 1 },
      contextoComLista([MOV.a, MOV.b, MOV.c], {}, { offset: 1 }),
      ctx,
      AGORA,
    );
    expect(r.status).toBe("resolved");
    if (r.status === "resolved") expect(r.entity.entity.id).toBe(MOV.b);
  });

  it("positional: index fora do range → not_found", async () => {
    const r = await new ReferenceResolverV3(criarDeps([ent(MOV.a)])).resolve(
      { type: "positional", index: 2 },
      contextoComLista([MOV.a]),
      ctx,
      AGORA,
    );
    expect(r.status).toBe("not_found");
  });

  it("positional: sem last_query → not_found", async () => {
    const r = await new ReferenceResolverV3(criarDeps([])).resolve(
      { type: "positional", index: 1 },
      estadoInicialConversacaoV3(AGORA),
      ctx,
      AGORA,
    );
    expect(r.status).toBe("not_found");
  });

  it("positional: lista expirada ignora last_query", async () => {
    const ctxExpirado = ConversationContextSchema.parse({
      ...estadoInicialConversacaoV3(AGORA),
      last_query: {
        information_need: {
          data_sources: ["transactions"],
          source_priority: ["transactions"],
          expected_output: "list",
        },
        query_spec: { entityType: "transaction" },
        result_ids: [MOV.a],
        result_summary: { count: 1 },
        expires_at: AGORA - 1,
      },
    });
    const r = await new ReferenceResolverV3(criarDeps([ent(MOV.a)])).resolve(
      { type: "positional", index: 1 },
      ctxExpirado,
      ctx,
      AGORA,
    );
    expect(r.status).toBe("not_found");
  });

  it("temporal: ontem no last_query", async () => {
    const deps = criarDeps([
      ent(MOV.a, { metadata: { dataMovimento: "2026-08-22" } }),
      ent(MOV.b, { metadata: { dataMovimento: "2026-08-21" } }),
    ]);
    const r = await new ReferenceResolverV3(deps).resolve(
      { type: "temporal", relative: "yesterday" },
      contextoComLista([MOV.a, MOV.b]),
      ctx,
      AGORA,
    );
    expect(r.status).toBe("resolved");
    if (r.status === "resolved") expect(r.entity.entity.id).toBe(MOV.a);
  });

  it("temporal: fallback searchEntities", async () => {
    const deps = criarDeps([ent(MOV.a, { metadata: { dataMovimento: "2026-08-22" } })]);
    const r = await new ReferenceResolverV3(deps).resolve(
      { type: "temporal", relative: "yesterday" },
      estadoInicialConversacaoV3(AGORA),
      ctx,
      AGORA,
    );
    expect(deps.searchEntities).toHaveBeenCalled();
    expect(r.status).toBe("resolved");
  });

  it("value: match exato 50", async () => {
    const deps = criarDeps([
      ent(MOV.a, { metadata: { valor: 50 } }),
      ent(MOV.b, { metadata: { valor: 35 } }),
    ]);
    const r = await new ReferenceResolverV3(deps).resolve(
      { type: "value", amount: 50 },
      contextoComLista([MOV.a, MOV.b]),
      ctx,
      AGORA,
    );
    expect(r.status).toBe("resolved");
    if (r.status === "resolved") expect(r.entity.entity.id).toBe(MOV.a);
  });

  it("value: search se não está no last_query", async () => {
    const deps = criarDeps([ent(MOV.a, { metadata: { valor: 80 } })]);
    const r = await new ReferenceResolverV3(deps).resolve(
      { type: "value", amount: 80 },
      estadoInicialConversacaoV3(AGORA),
      ctx,
      AGORA,
    );
    expect(r.status).toBe("resolved");
    expect(deps.searchEntities).toHaveBeenCalled();
  });

  it("merchant fuzzy ubr → Uber", async () => {
    const deps = criarDeps([ent(MOV.a, { metadata: { merchant: "Uber" } })]);
    const r = await new ReferenceResolverV3(deps).resolve(
      { type: "merchant", name: "ubr" },
      contextoComLista([MOV.a]),
      ctx,
      AGORA,
    );
    expect(r.status).toBe("resolved");
  });

  it("merchant: 3 Ubers → ambiguous", async () => {
    const deps = criarDeps([
      ent(MOV.a, { metadata: { merchant: "Uber", valor: 42, dataMovimento: "2026-08-21" } }),
      ent(MOV.b, { metadata: { merchant: "Uber", valor: 35, dataMovimento: "2026-08-22" } }),
      ent(MOV.c, { metadata: { merchant: "Uber", valor: 62, dataMovimento: "2026-08-20" } }),
    ]);
    const r = await new ReferenceResolverV3(deps).resolve(
      { type: "merchant", name: "uber" },
      contextoComLista([MOV.a, MOV.b, MOV.c]),
      ctx,
      AGORA,
    );
    expect(r.status).toBe("ambiguous");
    if (r.status === "ambiguous") expect(r.candidates.length).toBe(3);
  });

  it("merchant: focused_entity se last_query não casa", async () => {
    const focused: EntityRef = {
      id: MOV.a,
      type: "transaction",
      label: "Uber",
      metadata: { merchant: "Uber" },
    };
    const deps = criarDeps([ent(MOV.a, { metadata: { merchant: "Uber" } })]);
    deps.getEntitiesByIds = vi.fn(async () => [ent(MOV.b, { metadata: { merchant: "iFood" } })]);
    const r = await new ReferenceResolverV3(deps).resolve(
      { type: "merchant", name: "Uber" },
      contextoComLista([MOV.b], { focused_entity: focused }),
      ctx,
      AGORA,
    );
    expect(r.status).toBe("resolved");
    if (r.status === "resolved") expect(r.entity.entity.id).toBe(MOV.a);
  });

  it("anaphoric: focused_entity", async () => {
    const focused: EntityRef = { id: MOV.a, type: "transaction", label: "Uber R$ 50" };
    const r = await new ReferenceResolverV3(criarDeps([ent(MOV.a)])).resolve(
      { type: "anaphoric", pronoun: "that" },
      { ...estadoInicialConversacaoV3(AGORA), focused_entity: focused },
      ctx,
      AGORA,
    );
    expect(r.status).toBe("resolved");
    if (r.status === "resolved") expect(r.entity.entity.id).toBe(MOV.a);
  });

  it("anaphoric last → último da last_query", async () => {
    const deps = criarDeps([ent(MOV.a), ent(MOV.b), ent(MOV.c)]);
    const r = await new ReferenceResolverV3(deps).resolve(
      { type: "anaphoric", pronoun: "last" },
      contextoComLista([MOV.a, MOV.b, MOV.c]),
      ctx,
      AGORA,
    );
    expect(r.status).toBe("resolved");
    if (r.status === "resolved") expect(r.entity.entity.id).toBe(MOV.c);
  });

  it("anaphoric previous → último da last_query", async () => {
    const deps = criarDeps([ent(MOV.a), ent(MOV.b)]);
    const r = await new ReferenceResolverV3(deps).resolve(
      { type: "anaphoric", pronoun: "previous" },
      contextoComLista([MOV.a, MOV.b]),
      ctx,
      AGORA,
    );
    expect(r.status).toBe("resolved");
    if (r.status === "resolved") expect(r.entity.entity.id).toBe(MOV.b);
  });

  it("anaphoric that sem foco → primeiro da last_query", async () => {
    const deps = criarDeps([ent(MOV.a), ent(MOV.b)]);
    const r = await new ReferenceResolverV3(deps).resolve(
      { type: "anaphoric", pronoun: "that" },
      contextoComLista([MOV.a, MOV.b]),
      ctx,
      AGORA,
    );
    expect(r.status).toBe("resolved");
    if (r.status === "resolved") expect(r.entity.entity.id).toBe(MOV.a);
  });

  it("anaphoric: topic_history se não há last_query", async () => {
    const hist: EntityRef = { id: MOV.a, type: "transaction", label: "iFood" };
    const context = ConversationContextSchema.parse({
      ...estadoInicialConversacaoV3(AGORA),
      topic_history: [
        { topic: { domain: "spending", entities: [hist] }, goal: "analyze", started_at: AGORA - 1000 },
      ],
    });
    const r = await new ReferenceResolverV3(criarDeps([ent(MOV.a)])).resolve(
      { type: "anaphoric", pronoun: "that" },
      context,
      ctx,
      AGORA,
    );
    expect(r.status).toBe("resolved");
    if (r.status === "resolved") expect(r.entity.entity.id).toBe(MOV.a);
  });

  it("composite: merchant ∩ temporal", async () => {
    const deps = criarDeps([
      ent(MOV.a, { metadata: { merchant: "Uber", dataMovimento: "2026-08-22" } }),
      ent(MOV.b, { metadata: { merchant: "Uber", dataMovimento: "2026-08-21" } }),
      ent(MOV.c, { metadata: { merchant: "iFood", dataMovimento: "2026-08-21" } }),
    ]);
    const r = await new ReferenceResolverV3(deps).resolve(
      {
        type: "composite",
        parts: [
          { type: "merchant", name: "uber" },
          { type: "temporal", relative: "yesterday" },
        ],
      },
      contextoComLista([MOV.a, MOV.b, MOV.c]),
      ctx,
      AGORA,
    );
    expect(r.status).toBe("resolved");
    if (r.status === "resolved") expect(r.entity.entity.id).toBe(MOV.a);
  });

  it("composite: interseção vazia → not_found", async () => {
    const deps = criarDeps([
      ent(MOV.a, { metadata: { merchant: "Uber", dataMovimento: "2026-08-20" } }),
      ent(MOV.b, { metadata: { merchant: "iFood", dataMovimento: "2026-08-22" } }),
    ]);
    const r = await new ReferenceResolverV3(deps).resolve(
      {
        type: "composite",
        parts: [
          { type: "merchant", name: "uber" },
          { type: "temporal", relative: "yesterday" },
        ],
      },
      contextoComLista([MOV.a, MOV.b]),
      ctx,
      AGORA,
    );
    expect(r.status).toBe("not_found");
  });

  it("merchant inexistente → not_found", async () => {
    const deps = criarDeps([]);
    deps.searchEntities = vi.fn(async () => []);
    const r = await resolveReferenceV3(
      { type: "merchant", name: "xyz" },
      deps,
      estadoInicialConversacaoV3(AGORA),
      ctx,
      AGORA,
    );
    expect(r.status).toBe("not_found");
  });
});
