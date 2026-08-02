import { describe, expect, it } from "vitest";
import { montar_confirmacao_exclusao } from "../montar-confirmacao-exclusao";

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
