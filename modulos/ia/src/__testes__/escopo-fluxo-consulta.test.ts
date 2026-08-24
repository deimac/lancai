import { describe, expect, it } from "vitest";
import {
  aplicar_escopo_fluxo_na_consulta,
  inferir_escopo_fluxo_consulta,
} from "../escopo-fluxo-consulta";
import type { IntencaoConsultarVisao } from "@lancai/tipos";

describe("inferir_escopo_fluxo_consulta", () => {
  it("reconhece sinônimos de despesa", () => {
    expect(inferir_escopo_fluxo_consulta("Quanto gastei hoje?")).toBe("despesa");
    expect(inferir_escopo_fluxo_consulta("quais minhas despesas do mês")).toBe("despesa");
    expect(inferir_escopo_fluxo_consulta("o que eu paguei ontem")).toBe("despesa");
  });

  it("reconhece sinônimos de receita", () => {
    expect(inferir_escopo_fluxo_consulta("Quanto recebi hoje?")).toBe("receita");
    expect(inferir_escopo_fluxo_consulta("quanto entrou esse mês")).toBe("receita");
    expect(inferir_escopo_fluxo_consulta("quanto ganhei")).toBe("receita");
    expect(
      inferir_escopo_fluxo_consulta("quanto tive de entradas este mes na minha conta mercado pago?"),
    ).toBe("receita");
  });

  it("mantém extrato sem lado como ambos", () => {
    expect(inferir_escopo_fluxo_consulta("quais os lançamentos de hoje?")).toBe("ambos");
    expect(inferir_escopo_fluxo_consulta("mostra o extrato")).toBe("ambos");
    expect(inferir_escopo_fluxo_consulta("gastei e recebi hoje")).toBe("ambos");
  });
});

describe("aplicar_escopo_fluxo_na_consulta", () => {
  const base: IntencaoConsultarVisao = {
    intencao: "CONSULTAR_VISAO",
    tipo_visao: "historico",
    detalhado: false,
    filtros: { periodo: { de: "2026-08-10", ate: "2026-08-10" } },
  };

  it("força tipos na pergunta de gasto", () => {
    expect(aplicar_escopo_fluxo_na_consulta(base, "quanto gastei hoje?").filtros.tipos).toEqual([
      "despesa",
    ]);
  });

  it("preserva tipos no follow-up sem sinal de lado", () => {
    const comTipos: IntencaoConsultarVisao = {
      ...base,
      filtros: { ...base.filtros, tipos: ["despesa"] },
    };
    expect(aplicar_escopo_fluxo_na_consulta(comTipos, "detalhado").filtros.tipos).toEqual([
      "despesa",
    ]);
  });
});
