import { describe, expect, it } from "vitest";
import { estadoConsultaNovo, type QueryState } from "@lancai/tipos";
import { applySlotOps } from "../agente/apply-slot-ops";

const base = (): QueryState =>
  estadoConsultaNovo({
    period: { tipo: "mes_atual" },
    origemPerfil: "pj",
    tipos: ["despesa"],
    merchant: "Uber",
  });

describe("applySlotOps", () => {
  it("CARRYOVER: só muta slots presentes em ops", () => {
    const antes = base();
    const depois = applySlotOps(antes, [{ op: "set", slot: "period", value: { tipo: "mes_passado" } }]);
    expect(depois.period).toEqual({ tipo: "mes_passado" });
    expect(depois.origemPerfil).toBe("pj");
    expect(depois.merchant).toBe("Uber");
    expect(depois.tipos).toEqual(["despesa"]);
    expect(depois.grain).toBe("summary");
  });

  it("set substitui o array tipos inteiro", () => {
    const depois = applySlotOps(base(), [{ op: "set", slot: "tipos", value: ["receita"] }]);
    expect(depois.tipos).toEqual(["receita"]);
  });

  it("clear remove o slot (undefined, não null)", () => {
    const depois = applySlotOps(base(), [{ op: "clear", slot: "origemPerfil" }]);
    expect(depois.origemPerfil).toBeUndefined();
    expect("origemPerfil" in depois).toBe(false);
    expect(depois.merchant).toBe("Uber");
  });

  it("origemPerfil sobrevive a change_grain list e set canal=cartao", () => {
    let estado = applySlotOps(base(), [{ op: "set", slot: "grain", value: "list" }]);
    estado = applySlotOps(estado, [{ op: "set", slot: "canal", value: "cartao" }]);
    expect(estado.origemPerfil).toBe("pj");
    expect(estado.grain).toBe("list");
    expect(estado.canal).toBe("cartao");
    expect(estado.period).toEqual({ tipo: "mes_atual" });
  });

  it("entrada/saída em linguagem natural viram receita/despesa", () => {
    const depois = applySlotOps(base(), [{ op: "set", slot: "tipos", value: ["entradas"] }]);
    expect(depois.tipos).toEqual(["receita"]);
  });
});
