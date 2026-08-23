import { describe, expect, it, vi } from "vitest";
import { estadoInicialConversacao, type ConversationState, type EntityRef } from "@lancai/tipos";
import { ReferenceResolver, type EntityBusca, type ResolverDeps } from "../agente/reference-resolver";

const USER = "00000000-0000-4000-8000-000000000001";
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
    getEntitiesByIds: vi.fn(async (ids: string[]) => ids.map((id) => porId.get(id)).filter((e): e is EntityBusca => Boolean(e))),
    searchEntities: vi.fn(async () => entidades),
  };
}

function stateComLista(ids: string[], extra: Partial<ConversationState> = {}): ConversationState {
  return {
    ...estadoInicialConversacao(),
    lastResultSet: { ids, query: { entityType: "transaction" }, expiresAt: Date.now() + 600_000 },
    ...extra,
  };
}

describe("ReferenceResolver", () => {
  const ctx = { usuarioId: USER, currentDate: "2026-08-23" };

  describe("Positional", () => {
    it("resolves 'o segundo' com lastResultSet", async () => {
      const deps = criarDeps([
        ent(MOV.a, { label: "Uber R$ 42" }),
        ent(MOV.b, { label: "Uber R$ 35" }),
        ent(MOV.c, { label: "Uber R$ 62" }),
      ]);
      const resolver = new ReferenceResolver(deps);
      const result = await resolver.resolve(
        { type: "positional", index: 2 },
        stateComLista([MOV.a, MOV.b, MOV.c]),
        ctx,
      );
      expect(result.status).toBe("resolved");
      if (result.status === "resolved") expect(result.entity.entity.id).toBe(MOV.b);
    });

    it("index fora do range → not_found", async () => {
      const resolver = new ReferenceResolver(criarDeps([ent(MOV.a)]));
      const result = await resolver.resolve(
        { type: "positional", index: 2 },
        stateComLista([MOV.a]),
        ctx,
      );
      expect(result.status).toBe("not_found");
    });

    it("paginação: offset considerado", async () => {
      const deps = criarDeps([ent(MOV.a), ent(MOV.b), ent(MOV.c)]);
      const resolver = new ReferenceResolver(deps);
      const st = stateComLista([MOV.a, MOV.b, MOV.c]);
      st.lastResultSet = {
        ids: [MOV.a, MOV.b, MOV.c],
        query: { offset: 1, entityType: "transaction" },
        expiresAt: Date.now() + 600_000,
      };
      const result = await resolver.resolve({ type: "positional", index: 1 }, st, ctx);
      expect(result.status).toBe("resolved");
      if (result.status === "resolved") expect(result.entity.entity.id).toBe(MOV.b);
    });
  });

  describe("Temporal", () => {
    it("resolves 'o de ontem' via lastResultSet", async () => {
      const deps = criarDeps([
        ent(MOV.a, { metadata: { dataMovimento: "2026-08-22" } }),
        ent(MOV.b, { metadata: { dataMovimento: "2026-08-21" } }),
      ]);
      const resolver = new ReferenceResolver(deps);
      const result = await resolver.resolve(
        { type: "temporal", relative: "yesterday" },
        stateComLista([MOV.a, MOV.b]),
        ctx,
      );
      expect(result.status).toBe("resolved");
      if (result.status === "resolved") expect(result.entity.entity.id).toBe(MOV.a);
    });
  });

  describe("Value", () => {
    it("resolves 'o de 50' exact match", async () => {
      const deps = criarDeps([
        ent(MOV.a, { metadata: { valor: 50 } }),
        ent(MOV.b, { metadata: { valor: 35 } }),
      ]);
      const resolver = new ReferenceResolver(deps);
      const result = await resolver.resolve({ type: "value", amount: 50 }, stateComLista([MOV.a, MOV.b]), ctx);
      expect(result.status).toBe("resolved");
      if (result.status === "resolved") expect(result.entity.entity.id).toBe(MOV.a);
    });
  });

  describe("Merchant", () => {
    it("fuzzy match 'ubr' → uber", async () => {
      const deps = criarDeps([ent(MOV.a, { metadata: { merchant: "Uber" } })]);
      const resolver = new ReferenceResolver(deps);
      const result = await resolver.resolve(
        { type: "merchant", name: "ubr" },
        stateComLista([MOV.a]),
        ctx,
      );
      expect(result.status).toBe("resolved");
    });

    it("ambíguo: 3 ubers → ambiguous", async () => {
      const deps = criarDeps([
        ent(MOV.a, { metadata: { merchant: "Uber", valor: 42, dataMovimento: "2026-08-21" } }),
        ent(MOV.b, { metadata: { merchant: "Uber", valor: 35, dataMovimento: "2026-08-22" } }),
        ent(MOV.c, { metadata: { merchant: "Uber", valor: 62, dataMovimento: "2026-08-20" } }),
      ]);
      const resolver = new ReferenceResolver(deps);
      const result = await resolver.resolve(
        { type: "merchant", name: "uber" },
        stateComLista([MOV.a, MOV.b, MOV.c]),
        ctx,
      );
      expect(result.status).toBe("ambiguous");
      if (result.status === "ambiguous") expect(result.candidates.length).toBe(3);
    });
  });

  describe("Anaphoric", () => {
    it("'aquele' → currentEntity", async () => {
      const current: EntityRef = { id: MOV.a, type: "transaction", label: "Uber R$ 50" };
      const resolver = new ReferenceResolver(criarDeps([ent(MOV.a)]));
      const result = await resolver.resolve(
        { type: "anaphoric", pronoun: "that" },
        { ...estadoInicialConversacao(), currentEntity: current },
        ctx,
      );
      expect(result.status).toBe("resolved");
      if (result.status === "resolved") expect(result.entity.entity.id).toBe(MOV.a);
    });
  });

  describe("Composite", () => {
    it("intersect merchant + temporal", async () => {
      const deps = criarDeps([
        ent(MOV.a, { metadata: { merchant: "Uber", dataMovimento: "2026-08-22" } }),
        ent(MOV.b, { metadata: { merchant: "Uber", dataMovimento: "2026-08-21" } }),
        ent(MOV.c, { metadata: { merchant: "iFood", dataMovimento: "2026-08-21" } }),
      ]);
      const resolver = new ReferenceResolver(deps);
      const result = await resolver.resolve(
        {
          type: "composite",
          parts: [
            { type: "merchant", name: "uber" },
            { type: "temporal", relative: "yesterday" },
          ],
        },
        stateComLista([MOV.a, MOV.b, MOV.c]),
        ctx,
      );
      expect(result.status).toBe("resolved");
      if (result.status === "resolved") expect(result.entity.entity.id).toBe(MOV.a);
    });
  });

  describe("Política de ambiguidade", () => {
    it("nenhum candidato → not_found", async () => {
      const deps = criarDeps([]);
      deps.searchEntities = vi.fn(async () => []);
      const resolver = new ReferenceResolver(deps);
      const result = await resolver.resolve(
        { type: "merchant", name: "xyz" },
        estadoInicialConversacao(),
        ctx,
      );
      expect(result.status).toBe("not_found");
    });
  });

  it("update sem target usa currentEntity", async () => {
    const deps = criarDeps([ent(MOV.a, { label: "Uber" })]);
    const resolver = new ReferenceResolver(deps);
    const state = {
      ...estadoInicialConversacao(),
      currentEntity: ent(MOV.a, { label: "Uber" }),
    };
    const resolved = await resolver.resolveRequest(
      { op: "update", resource: "transaction", params: { valor: 80 } },
      state,
      ctx,
    );
    expect(resolved.resolved.target?.id).toBe(MOV.a);
  });
});
