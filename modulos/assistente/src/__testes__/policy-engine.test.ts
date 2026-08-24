import { describe, expect, it } from "vitest";
import { estadoInicialConversacao, type ResolvedRequest, type UserRequest } from "@lancai/tipos";
import { PolicyEngine } from "../agente/policy-engine";

const CAT = "00000000-0000-4000-8000-000000000201";
const CONTA = "00000000-0000-4000-8000-000000000202";
const MOV = "00000000-0000-4000-8000-000000000101";

function rr(over: Partial<UserRequest> & { resolved?: ResolvedRequest["resolved"] }): ResolvedRequest {
  const request: UserRequest = {
    op: over.op ?? "query",
    resource: over.resource ?? "transaction",
    params: over.params ?? {},
    meta: over.meta,
    references: over.references,
  };
  return {
    request,
    resolved: over.resolved ?? {},
    semanticConfidence: 0.9,
  };
}

describe("PolicyEngine", () => {
  const engine = new PolicyEngine();
  const state = estadoInicialConversacao();

  it("Query", () => {
    const result = engine.evaluate(rr({ op: "query" }), state);
    expect(result).toMatchObject({ allowed: true, confirm: false, reason: "auto" });
  });

  it("Classify", () => {
    const result = engine.evaluate(
      rr({
        op: "classify",
        params: { perfil: "pf" },
        resolved: { target: { id: MOV, type: "transaction", label: "Uber" } },
      }),
      state,
    );
    expect(result).toMatchObject({ allowed: true, confirm: false, reason: "auto" });
  });

  it("Create transaction", () => {
    const result = engine.evaluate(rr({ op: "create", resource: "transaction", params: { valor: 50 } }), state);
    expect(result).toMatchObject({ allowed: true, confirm: true, reason: "risk" });
  });

  it("Update conhecimento (categoria)", () => {
    const result = engine.evaluate(
      rr({
        op: "update",
        params: { categoriaId: CAT },
        resolved: { target: { id: MOV, type: "transaction", label: "Uber", metadata: { fatoImutavel: false } } },
      }),
      state,
    );
    expect(result).toMatchObject({ allowed: true, confirm: true, reason: "risk" });
  });

  it("Update fato (valor)", () => {
    const result = engine.evaluate(
      rr({
        op: "update",
        params: { valor: 80 },
        resolved: { target: { id: MOV, type: "transaction", label: "Uber", metadata: { fatoImutavel: false } } },
      }),
      state,
    );
    expect(result).toMatchObject({ allowed: true, confirm: true, reason: "risk" });
  });

  it("Update fato (conta)", () => {
    const result = engine.evaluate(
      rr({
        op: "update",
        params: { contaId: CONTA },
        resolved: { target: { id: MOV, type: "transaction", label: "Uber" } },
      }),
      state,
    );
    expect(result).toMatchObject({ allowed: true, confirm: true, reason: "risk" });
  });

  it("Delete manual", () => {
    const result = engine.evaluate(
      rr({
        op: "delete",
        resolved: { target: { id: MOV, type: "transaction", label: "Uber", metadata: { fatoImutavel: false } } },
      }),
      state,
    );
    expect(result).toMatchObject({ allowed: true, confirm: true, reason: "risk" });
  });

  it("Delete OF → blocked", () => {
    const result = engine.evaluate(
      rr({
        op: "delete",
        resolved: { target: { id: MOV, type: "transaction", label: "Uber", metadata: { fatoImutavel: true } } },
      }),
      state,
    );
    expect(result).toMatchObject({ allowed: false, risk: "blocked", reason: "of_cannot_delete" });
  });

  it("Update fato OF → blocked", () => {
    const result = engine.evaluate(
      rr({
        op: "update",
        params: { valor: 80 },
        resolved: { target: { id: MOV, type: "transaction", label: "Uber", metadata: { fatoImutavel: true } } },
      }),
      state,
    );
    expect(result).toMatchObject({ allowed: false, risk: "blocked", reason: "of_fato_immutable" });
  });

  it("Create recurrence", () => {
    const result = engine.evaluate(
      rr({ op: "create", resource: "recurrence", params: { descricao: "Netflix", valor: 55, diaDoMes: 10 } }),
      state,
    );
    expect(result).toMatchObject({ allowed: true, confirm: true, reason: "risk" });
  });

  it("Ambiguidade → blocked", () => {
    const result = engine.evaluate(rr({ op: "update", resolved: {} }), state);
    expect(result).toMatchObject({ allowed: false, risk: "blocked", reason: "ambiguity" });
  });

  it("evaluateCommand: query sem confirmação", () => {
    const result = engine.evaluateCommand({ type: "query_transactions", spec: { merchant: "Uber" } });
    expect(result).toMatchObject({ allowed: true, confirm: false, reason: "auto" });
  });

  it("evaluateCommand: create confirma", () => {
    const result = engine.evaluateCommand({
      type: "create_transaction",
      input: { valor: 50, descricao: "Uber", contaId: CONTA },
    });
    expect(result).toMatchObject({ allowed: true, confirm: true, reason: "risk" });
  });

  it("evaluateCommand: delete OF blocked", () => {
    const result = engine.evaluateCommand(
      { type: "cancel_transaction", input: { movementId: MOV } },
      { id: MOV, type: "transaction", label: "Uber", metadata: { fatoImutavel: true } },
    );
    expect(result).toMatchObject({ allowed: false, risk: "blocked", reason: "of_cannot_delete" });
  });
});
