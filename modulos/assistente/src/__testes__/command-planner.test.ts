import { describe, expect, it } from "vitest";
import { ConversationUnderstandingSchema, estadoInicialConversacaoV3, type ResolutionResult } from "@lancai/tipos";
import { planCommand, planCommandFromAct, planCancelarLancamentos } from "../agente/command-planner";
import { understandingToDialogueAct } from "../agente/understanding-to-dialogue-act";
import { AGORA, CASOS_UNDERSTANDING, DATA_ATUAL, MOVIMENTO_UBER, MOVIMENTO_UBER_B } from "./casos-understanding";

function caso(id: string) {
  const c = CASOS_UNDERSTANDING.find((x) => x.id === id);
  if (!c) throw new Error(`caso ${id} ausente`);
  return c;
}

const resolvido: ResolutionResult = {
  status: "resolved",
  entity: {
    entity: { id: MOVIMENTO_UBER, type: "transaction", label: "Uber" },
    confidence: 1,
    method: "positional",
  },
};

describe("planCommand", () => {
  it("create Uber → create_transaction sem contaId", () => {
    const r = planCommand(caso("create-uber-nubank").understanding);
    expect(r?.kind).toBe("plan");
    if (r?.kind !== "plan") return;
    expect(r.plan.steps[0]?.command).toEqual({
      type: "create_transaction",
      input: { descricao: "Uber", valor: 50, tipo: "despesa", contaNome: "Nubank" },
    });
  });

  it("create receita", () => {
    const r = planCommand(caso("create-salario").understanding);
    expect(r?.kind).toBe("plan");
    if (r?.kind !== "plan") return;
    expect(r.plan.steps[0]?.command.type).toBe("create_transaction");
    if (r.plan.steps[0]?.command.type === "create_transaction") {
      expect(r.plan.steps[0].command.input.tipo).toBe("receita");
      expect(r.plan.steps[0].command.input.valor).toBe(1000);
    }
  });

  it("update valor com alvo resolvido", () => {
    const r = planCommand(caso("ref-merchant-uber").understanding, { resolved: resolvido });
    expect(r?.kind).toBe("plan");
    if (r?.kind !== "plan") return;
    expect(r.plan.steps[0]?.command).toMatchObject({
      type: "update_transaction",
      input: { movementId: MOVIMENTO_UBER, fatoPatch: { valor: 80 } },
    });
  });

  it("update categoria sem UUID → clarify", () => {
    const r = planCommand(caso("correcao-conta-conhecimento").understanding, { resolved: resolvido });
    expect(r?.kind).toBe("clarify");
    if (r?.kind === "clarify") expect(r.ambiguity[0]?.field).toBe("category");
  });

  it("delete com alvo resolvido → cancel_transaction", () => {
    const r = planCommand(caso("cancelar-manual").understanding, { resolved: resolvido });
    expect(r?.kind).toBe("plan");
    if (r?.kind !== "plan") return;
    expect(r.plan.steps[0]?.command).toEqual({
      type: "cancel_transaction",
      input: { movementId: MOVIMENTO_UBER },
    });
  });

  it("create recurrence", () => {
    const understanding = ConversationUnderstandingSchema.parse({
      goal: "execute",
      question: {
        intent: "create",
        entities: { merchant: "Netflix", amount: 39.9 },
        implicit_filters: { fonte: "recorrencias", tipo: "despesa" },
      },
      confidence: 0.9,
      required_sources: ["recurrences"],
    });
    const r = planCommand(understanding);
    expect(r?.kind).toBe("plan");
    if (r?.kind !== "plan") return;
    expect(r.plan.steps[0]?.command).toEqual({
      type: "create_recurrence",
      input: { descricao: "Netflix", valor: 39.9, diaDoMes: 1 },
    });
  });

  it("create rule sem categoria UUID → clarify", () => {
    const understanding = ConversationUnderstandingSchema.parse({
      goal: "execute",
      question: {
        intent: "create",
        entities: { merchant: "Uber", category: "Transporte" },
      },
      confidence: 0.8,
      required_sources: ["categories"],
    });
    const r = planCommand(understanding);
    expect(r?.kind).toBe("clarify");
    if (r?.kind === "clarify") expect(r.ambiguity[0]?.field).toBe("category");
  });

  it("foi ontem → update dataMovimento", () => {
    const r = planCommand(caso("correcao-foi-ontem").understanding, {
      resolved: resolvido,
      dataAtual: DATA_ATUAL,
    });
    expect(r?.kind).toBe("plan");
    if (r?.kind !== "plan") return;
    expect(r.plan.steps[0]?.command).toMatchObject({
      type: "update_transaction",
      input: {
        movementId: MOVIMENTO_UBER,
        fatoPatch: { dataMovimento: "2026-08-22" },
      },
    });
  });

  it("referência posicional usa o resolved, não inventa UUID", () => {
    const r = planCommand(caso("ref-posicional-segundo").understanding, { resolved: resolvido });
    expect(r?.kind).toBe("plan");
    if (r?.kind !== "plan") return;
    expect(r.plan.steps[0]?.command.type).toBe("update_transaction");
    if (r.plan.steps[0]?.command.type === "update_transaction") {
      expect(r.plan.steps[0].command.input.movementId).toBe(MOVIMENTO_UBER);
      expect(r.plan.steps[0].command.input.conhecimentoPatch?.perfil).toBe("pf");
    }
  });

  it("ambiguidade → clarify sem CommandPlan", () => {
    const r = planCommand(caso("ambiguidade-tres-ubers").understanding, { resolved: resolvido });
    expect(r?.kind).toBe("clarify");
  });

  it("update sem resolved → unresolved", () => {
    const r = planCommand(caso("ref-merchant-uber").understanding);
    expect(r?.kind).toBe("unresolved");
  });

  it("greet → null", () => {
    expect(planCommand(caso("greet").understanding)).toBeNull();
  });

  it("golden pagamento de fatura no Revolut usa o slot, não a descrição", () => {
    const r = planCommand(caso("create-pagamento-fatura-revolut").understanding);
    expect(r?.kind).toBe("plan");
    if (r?.kind !== "plan") return;
    expect(r.plan.steps[0]?.command).toEqual({
      type: "create_transaction",
      input: {
        valor: 1158.55,
        tipo: "receita",
        papel: "pagamento_fatura",
        dataMovimento: "2026-08-17",
        cartaoNome: "Revolut",
      },
    });
  });

  it("golden paguei a fatura tem os mesmos slots", () => {
    const r = planCommand(caso("create-paguei-fatura-revolut").understanding);
    expect(r?.kind).toBe("plan");
    if (r?.kind !== "plan") return;
    expect(r.plan.steps[0]?.command).toMatchObject({
      type: "create_transaction",
      input: { papel: "pagamento_fatura", tipo: "receita", valor: 1158.55, dataMovimento: "2026-08-17" },
    });
  });

  it("golden quita o Azul pela Nubank vira despesa", () => {
    const r = planCommand(caso("create-quita-azul-nubank").understanding);
    expect(r?.kind).toBe("plan");
    if (r?.kind !== "plan") return;
    expect(r.plan.steps[0]?.command).toEqual({
      type: "create_transaction",
      input: {
        valor: 2000,
        tipo: "despesa",
        papel: "pagamento_fatura",
        dataMovimento: "2026-08-22",
        contaNome: "Nubank",
        cartaoNome: "Azul",
      },
    });
  });

  it("golden Uber no Revolut não vira pagamento de fatura", () => {
    const r = planCommand(caso("create-gasto-uber-revolut").understanding);
    expect(r?.kind).toBe("plan");
    if (r?.kind !== "plan") return;
    expect(r.plan.steps[0]?.command).toEqual({
      type: "create_transaction",
      input: { descricao: "Uber", valor: 50, tipo: "despesa", cartaoNome: "Revolut" },
    });
  });

  it("adapter copia implicit_filters.papel para WriteIntent", () => {
    const act = understandingToDialogueAct(
      caso("create-pagamento-fatura-revolut").understanding,
      estadoInicialConversacaoV3(AGORA),
    );
    expect(act).toMatchObject({
      act: "write",
      intent: {
        papel: "pagamento_fatura",
        cartaoNome: "Revolut",
        valor: 1158.55,
        data: "2026-08-17",
      },
    });
  });
});

describe("planCommandFromAct", () => {
  it("write → create_transaction", () => {
    const r = planCommandFromAct({
      act: "write",
      intent: { tipo: "despesa", valor: 50, descricao: "Uber", contaNome: "Nubank" },
    });
    expect(r?.kind).toBe("plan");
    if (r?.kind !== "plan") return;
    expect(r.plan.steps[0]?.command).toEqual({
      type: "create_transaction",
      input: { descricao: "Uber", valor: 50, tipo: "despesa", contaNome: "Nubank" },
    });
  });

  it("pagamento de fatura no cartão vira crédito de quitação pelo slot papel", () => {
    const r = planCommandFromAct({
      act: "write",
      intent: {
        papel: "pagamento_fatura",
        valor: 1158.55,
        descricao: "quitação",
        cartaoNome: "Revolut",
        data: "2026-08-17",
      },
    });
    expect(r?.kind).toBe("plan");
    if (r?.kind !== "plan") return;
    expect(r.plan.steps[0]?.command).toEqual({
      type: "create_transaction",
      input: {
        descricao: "quitação",
        valor: 1158.55,
        tipo: "receita",
        papel: "pagamento_fatura",
        dataMovimento: "2026-08-17",
        cartaoNome: "Revolut",
      },
    });
  });

  it("descrição com fatura sem slot papel não vira pagamento de fatura", () => {
    const r = planCommandFromAct({
      act: "write",
      intent: {
        tipo: "despesa",
        valor: 1158.55,
        descricao: "pagamento de fatura",
        cartaoNome: "Revolut",
        data: "2026-08-17",
      },
    });
    expect(r?.kind).toBe("plan");
    if (r?.kind !== "plan") return;
    expect(r.plan.steps[0]?.command).toEqual({
      type: "create_transaction",
      input: {
        descricao: "pagamento de fatura",
        valor: 1158.55,
        tipo: "despesa",
        dataMovimento: "2026-08-17",
        cartaoNome: "Revolut",
      },
    });
  });

  it("pagamento de fatura com conta vira despesa na conta", () => {
    const r = planCommandFromAct({
      act: "write",
      intent: {
        papel: "pagamento_fatura",
        valor: 2000,
        cartaoNome: "Azul",
        contaNome: "Nubank",
        data: "2026-08-22",
      },
    });
    expect(r?.kind).toBe("plan");
    if (r?.kind !== "plan") return;
    expect(r.plan.steps[0]?.command).toEqual({
      type: "create_transaction",
      input: {
        valor: 2000,
        tipo: "despesa",
        papel: "pagamento_fatura",
        dataMovimento: "2026-08-22",
        contaNome: "Nubank",
        cartaoNome: "Azul",
      },
    });
  });

  it("pagamento de fatura sem cartão pede esclarecimento", () => {
    const r = planCommandFromAct({
      act: "write",
      intent: { papel: "pagamento_fatura", valor: 200, descricao: "quitação" },
    });
    expect(r?.kind).toBe("clarify");
    if (r?.kind === "clarify") expect(r.ambiguity[0]?.field).toBe("card");
  });

  it("compra no cartão não vira pagamento de fatura", () => {
    const r = planCommandFromAct({
      act: "write",
      intent: { tipo: "despesa", valor: 50, descricao: "Uber", cartaoNome: "Revolut" },
    });
    expect(r?.kind).toBe("plan");
    if (r?.kind !== "plan") return;
    expect(r.plan.steps[0]?.command).toEqual({
      type: "create_transaction",
      input: { descricao: "Uber", valor: 50, tipo: "despesa", cartaoNome: "Revolut" },
    });
  });

  it("update com amount no patch", () => {
    const r = planCommandFromAct(
      { act: "update", target: { by: "amount", value: 850 }, patch: { valor: 580 } },
      { resolved: resolvido },
    );
    expect(r?.kind).toBe("plan");
    if (r?.kind !== "plan") return;
    expect(r.plan.steps[0]?.command).toMatchObject({
      type: "update_transaction",
      input: { movementId: MOVIMENTO_UBER, fatoPatch: { valor: 580 } },
    });
  });

  it("delete sem alvo → unresolved", () => {
    const r = planCommandFromAct({ act: "delete" });
    expect(r?.kind).toBe("unresolved");
  });
});

describe("planCancelarLancamentos", () => {
  it("monta um step por id", () => {
    const r = planCancelarLancamentos([MOVIMENTO_UBER, MOVIMENTO_UBER_B]);
    expect(r.kind).toBe("plan");
    if (r.kind !== "plan") return;
    expect(r.plan.steps).toHaveLength(2);
    expect(r.plan.steps.map((s) => s.command)).toEqual([
      { type: "cancel_transaction", input: { movementId: MOVIMENTO_UBER } },
      { type: "cancel_transaction", input: { movementId: MOVIMENTO_UBER_B } },
    ]);
  });
});
