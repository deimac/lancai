import { describe, expect, it } from "vitest";
import { consulta_historico_detalhada } from "../consulta-historico-detalhada";

describe("consulta_historico_detalhada", () => {
  it("perguntas de soma pedem só total", () => {
    expect(consulta_historico_detalhada("quanto gastei de uber esse mês?")).toBe(false);
    expect(consulta_historico_detalhada("quanto gastei hoje?")).toBe(false);
    expect(consulta_historico_detalhada("qual o total de despesas do mês?")).toBe(false);
    expect(consulta_historico_detalhada("resumo do mês")).toBe(false);
  });

  it("pedidos de lista/extrato são detalhados", () => {
    expect(consulta_historico_detalhada("mostra os gastos de hoje")).toBe(true);
    expect(consulta_historico_detalhada("liste os lançamentos de uber")).toBe(true);
    expect(consulta_historico_detalhada("extrato de ontem")).toBe(true);
    expect(consulta_historico_detalhada("quais foram meus gastos esse mês")).toBe(true);
    expect(consulta_historico_detalhada("detalhado")).toBe(true);
    expect(consulta_historico_detalhada("me detalhe os gastos")).toBe(true);
  });

  it("quanto + detalhado força lista", () => {
    expect(consulta_historico_detalhada("quanto gastei de uber? detalhado")).toBe(true);
  });
});
