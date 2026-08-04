import { describe, expect, it } from "vitest";
import { formatarMoeda } from "@lancai/tipos";
import {
  montar_confirmacao_duplicata_lancamento,
  montar_confirmacao_exclusao,
  montar_confirmacao_exclusao_lancamento,
} from "../montar-confirmacao-exclusao";

describe("montar_confirmacao_exclusao", () => {
  it("pergunta confirmação simples quando não há lançamentos vinculados", () => {
    expect(montar_confirmacao_exclusao("cartão", "Nubank", 0)).toBe(
      'Deseja realmente excluir o cartão "Nubank"? Responda "sim" para confirmar ou "não" para cancelar.',
    );
  });

  it("reforça o aviso quando há um lançamento vinculado", () => {
    const texto = montar_confirmacao_exclusao("cartão", "Nubank", 1);
    expect(texto).toContain('Deseja realmente excluir o cartão "Nubank"?');
    expect(texto).toContain("existe 1 lançamento vinculado");
    expect(texto).toContain("histórico dos lançamentos é preservado");
  });

  it("usa plural e artigo corretos para conta com vários lançamentos", () => {
    const texto = montar_confirmacao_exclusao("conta", "C6 Bank", 3);
    expect(texto).toContain('Deseja realmente excluir a conta "C6 Bank"?');
    expect(texto).toContain("existem 3 lançamentos vinculados");
    expect(texto).toContain("a essa conta");
  });
});

describe("montar_confirmacao_exclusao_lancamento", () => {
  it("pergunta confirmação com descrição, data e valor", () => {
    expect(montar_confirmacao_exclusao_lancamento("Almoço", "2026-08-02", 45)).toBe(
      `Deseja realmente excluir o lançamento "Almoço" de 02/08/2026 (${formatarMoeda(45)})? Responda "sim" para confirmar ou "não" para cancelar.`,
    );
  });

  it("usa plural quando há vários lançamentos", () => {
    expect(montar_confirmacao_exclusao_lancamento("farmacia", "2026-08-02", 37.96, 2)).toBe(
      `Deseja realmente excluir os 2 lançamentos de "farmacia" de 02/08/2026 (total ${formatarMoeda(37.96)})? Responda "sim" para confirmar ou "não" para cancelar.`,
    );
  });
});

describe("montar_confirmacao_duplicata_lancamento", () => {
  it("avisa lançamento igual e pede confirmação", () => {
    expect(
      montar_confirmacao_duplicata_lancamento("Farmacia", "2026-08-02", 18.98, "no cartão Azul Itaú"),
    ).toBe(
      `Já existe um lançamento igual: "Farmacia" de 02/08/2026 (${formatarMoeda(18.98)}) no cartão Azul Itaú. Deseja registrar mesmo assim? Responda "sim" para confirmar ou "não" para cancelar.`,
    );
  });
});
