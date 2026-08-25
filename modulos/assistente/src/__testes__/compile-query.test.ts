import { describe, expect, it } from "vitest";
import { estadoConsultaNovo } from "@lancai/tipos";
import { applySlotOps } from "../agente/apply-slot-ops";
import { compileQuery, visaoDeQueryState } from "../agente/compile-query";

const USER = "00000000-0000-4000-8000-000000000001";

describe("compileQuery", () => {
  it("mapeia grain e origemPerfil para FiltrosVisaoResolvidos", () => {
    const query = estadoConsultaNovo({
      grain: "list",
      origemPerfil: "pj",
      tipos: ["despesa"],
      period: { tipo: "mes_atual" },
      canal: "cartao",
    });
    const compiled = compileQuery(query, { usuarioId: USER, dataAtual: "2026-08-24" });
    expect(compiled.visao).toBe("historico");
    expect(compiled.filtros.origemPerfil).toBe("pj");
    expect(compiled.filtros.perfil).toBeUndefined();
    expect(compiled.filtros.canal).toBe("cartao");
    expect(compiled.filtros.tipos).toEqual(["despesa"]);
    expect(compiled.filtros.periodo).toEqual({ de: "2026-08-01", ate: "2026-08-31" });
  });

  it("cruzado/direcao escolhe visão fluxo", () => {
    expect(visaoDeQueryState(estadoConsultaNovo({ cruzado: true }))).toBe("fluxo");
    expect(visaoDeQueryState(estadoConsultaNovo({ direcao: "pessoal_com_empresa" }))).toBe("fluxo");
  });

  it("accounts → saldos; cards+summary → cartoes; category → categoria; month → evolucao", () => {
    expect(visaoDeQueryState(estadoConsultaNovo({ entityDomain: "accounts" }))).toBe("saldos");
    expect(visaoDeQueryState(estadoConsultaNovo({ entityDomain: "cards", grain: "summary" }))).toBe("cartoes");
    expect(visaoDeQueryState(estadoConsultaNovo({ grain: "category" }))).toBe("categoria");
    expect(visaoDeQueryState(estadoConsultaNovo({ grain: "month" }))).toBe("evolucao");
  });

  it("patch de grain não reescrece origemPerfil no compile", () => {
    const query = applySlotOps(
      estadoConsultaNovo({ origemPerfil: "pj", period: { tipo: "mes_atual" } }),
      [{ op: "set", slot: "grain", value: "list" }],
    );
    const compiled = compileQuery(query, { usuarioId: USER, dataAtual: "2026-08-24" });
    expect(compiled.filtros.origemPerfil).toBe("pj");
    expect(compiled.visao).toBe("historico");
  });

  it("sem período no QueryState não inventa recorte", () => {
    const compiled = compileQuery(estadoConsultaNovo({ origemPerfil: "pj" }), {
      usuarioId: USER,
      dataAtual: "2026-08-24",
    });
    expect(compiled.filtros.periodo).toBeUndefined();
  });
});
