import { describe, expect, it } from "vitest";
import { estadoInicialConversacao } from "@lancai/tipos";
import { StateUpdater } from "../agente/state-updater";

const MOV = "00000000-0000-4000-8000-000000000101";
const MOV2 = "00000000-0000-4000-8000-000000000102";

describe("StateUpdater", () => {
  const updater = new StateUpdater();

  it("create incrementa version e define currentEntity", () => {
    const state = estadoInicialConversacao();
    const original = { ...state };
    const novo = updater.updateAfterCommand(
      state,
      { type: "create_transaction", input: { valor: 50, descricao: "Uber" } },
      { success: true, entityRef: { id: MOV, type: "transaction", label: "Uber" } },
    );
    expect(novo.version).toBe(1);
    expect(novo.currentEntity?.id).toBe(MOV);
    expect(novo.lastResultSet).toBeUndefined();
    expect(state.version).toBe(original.version);
  });

  it("update invalida lastResultSet se o id está na lista", () => {
    const state = {
      ...estadoInicialConversacao(),
      lastResultSet: { ids: [MOV, MOV2], query: {}, expiresAt: Date.now() + 10000 },
      currentEntity: { id: MOV, type: "transaction" as const, label: "Uber" },
    };
    const novo = updater.updateAfterCommand(
      state,
      {
        type: "update_transaction",
        input: { movementId: MOV, fatoPatch: { valor: 80 } },
      },
      { success: true, entityRef: { id: MOV, type: "transaction", label: "Uber 80" } },
    );
    expect(novo.lastResultSet).toBeUndefined();
    expect(novo.currentEntity?.label).toBe("Uber 80");
  });

  it("cancel limpa currentEntity", () => {
    const state = {
      ...estadoInicialConversacao(),
      currentEntity: { id: MOV, type: "transaction" as const, label: "Uber" },
    };
    const novo = updater.updateAfterCommand(
      state,
      { type: "cancel_transaction", input: { movementId: MOV } },
      { success: true, entityRef: { id: MOV, type: "transaction", label: "Uber" } },
    );
    expect(novo.currentEntity).toBeUndefined();
  });

  it("query grava lastResultSet e preserva currentEntity", () => {
    const current = { id: MOV, type: "transaction" as const, label: "Uber" };
    const state = { ...estadoInicialConversacao(), currentEntity: current };
    const novo = updater.updateAfterQuery(state, { merchant: "Uber" }, [MOV, MOV2]);
    expect(novo.lastResultSet?.ids).toEqual([MOV, MOV2]);
    expect(novo.currentEntity?.id).toBe(MOV);
  });

  it("confirmação limpa pending", () => {
    const state = {
      ...estadoInicialConversacao(),
      pendingConfirmation: {
        confirmationId: "00000000-0000-4000-8000-000000000401",
        requestHash: "abc",
        stateVersion: 0,
        message: "Confirmar?",
        options: ["sim", "não"],
        expiresAt: Date.now() + 10000,
      },
    };
    const sim = updater.updateAfterConfirmation(state, true);
    const nao = updater.updateAfterConfirmation(state, false);
    expect(sim.pendingConfirmation).toBeUndefined();
    expect(nao.pendingConfirmation).toBeUndefined();
    expect(sim.version).toBe(1);
  });
});
