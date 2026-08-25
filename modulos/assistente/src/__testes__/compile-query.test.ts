import { describe, expect, it } from "vitest";
import { estadoConsultaNovo } from "@lancai/tipos";
import { applySlotOps } from "../agente/apply-slot-ops";
import { compileQuery, visaoDeQueryState } from "../agente/compile-query";
import { montarPromptSistemaDialogueAct } from "../prompts/dialogue-act";

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

  it("receita com pessoa e sem período busca o histórico completo", () => {
    const compiled = compileQuery(
      estadoConsultaNovo({
        grain: "summary",
        tipos: ["receita"],
        merchant: "Tayna Santos",
      }),
      { usuarioId: USER, dataAtual: "2026-08-25" },
    );
    expect(compiled.filtros.descricao).toBe("Tayna Santos");
    expect(compiled.filtros.tipos).toEqual(["receita"]);
    expect(compiled.filtros.periodo).toEqual({ de: "2000-01-01", ate: "2026-08-25" });
  });

  it("pessoa sem tipos e sem período também busca o histórico completo", () => {
    const compiled = compileQuery(
      estadoConsultaNovo({
        grain: "summary",
        merchant: "Tayna Santos",
      }),
      { usuarioId: USER, dataAtual: "2026-08-25" },
    );
    expect(compiled.filtros.periodo).toEqual({ de: "2000-01-01", ate: "2026-08-25" });
  });

  it("grain top ordena por valor desc e limita a 1", () => {
    const query = applySlotOps(
      estadoConsultaNovo({
        origemPerfil: "pj",
        tipos: ["despesa"],
        grain: "list",
        period: { tipo: "personalizado", de: "2026-08-24", ate: "2026-08-24" },
      }),
      [
        { op: "set", slot: "tipos", value: ["receita"] },
        { op: "set", slot: "grain", value: "top" },
      ],
    );
    const compiled = compileQuery(query, { usuarioId: USER, dataAtual: "2026-08-24" });
    expect(compiled.visao).toBe("historico");
    expect(compiled.filtros.tipos).toEqual(["receita"]);
    expect(compiled.filtros.origemPerfil).toBe("pj");
    expect(compiled.opcoes.ordenacao).toEqual({ by: "valor", dir: "desc" });
    expect(compiled.opcoes.limite).toBe(1);
  });

  it("grain list honra sort e limit", () => {
    const query = estadoConsultaNovo({
      grain: "list",
      period: { tipo: "personalizado", de: "2026-08-24", ate: "2026-08-24" },
      sort: { by: "data", dir: "desc" },
      limit: 3,
    });
    const compiled = compileQuery(query, { usuarioId: USER, dataAtual: "2026-08-24" });
    expect(compiled.opcoes.ordenacao).toEqual({ by: "data", dir: "desc" });
    expect(compiled.opcoes.limite).toBe(3);
  });

  it("grain top com sort asc é o menor, não o maior", () => {
    const compiled = compileQuery(
      estadoConsultaNovo({
        grain: "top",
        tipos: ["despesa"],
        sort: { by: "valor", dir: "asc" },
        limit: 1,
      }),
      { usuarioId: USER, dataAtual: "2026-08-24" },
    );
    expect(compiled.opcoes.ordenacao).toEqual({ by: "valor", dir: "asc" });
    expect(compiled.opcoes.limite).toBe(1);
  });

  it("grain summary ignora sort e limit", () => {
    const query = estadoConsultaNovo({
      grain: "summary",
      tipos: ["despesa"],
      sort: { by: "valor", dir: "desc" },
      limit: 3,
    });
    const compiled = compileQuery(query, { usuarioId: USER, dataAtual: "2026-08-24" });
    expect(compiled.opcoes.ordenacao).toBeUndefined();
    expect(compiled.opcoes.limite).toBeUndefined();
  });
});

describe("prompt DialogueAct", () => {
  it("ensina operações de grain sem atalho de frase", () => {
    const system = montarPromptSistemaDialogueAct();
    expect(system).toMatch(/maior entrada/i);
    expect(system).toMatch(/grain=top/);
    expect(system).toMatch(/"value":"top"/);
    expect(system).toMatch(/NÃO use summary/i);
    expect(system).toMatch(/últimos N/i);
    expect(system).toContain('"grain":"list"');
    expect(system).toMatch(/entradas menos saídas/i);
    expect(system).toMatch(/entityDomain":"accounts/);
    expect(system).toContain("change_grain");
    expect(system).toMatch(/cancela o 1/i);
    expect(system).toContain("ordinal_range");
    expect(system).toMatch(/YYYY-MM-DD/);
    expect(system).toMatch(/e sábado eu tive entradas/i);
    expect(system).toMatch(/Tayna Santos me enviou/i);
    expect(system).toMatch(/recebi de pix da Tayna Santos/i);
  });
});
