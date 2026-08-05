import { describe, expect, it } from "vitest";
import { formatarMoeda } from "@lancai/tipos";
import {
  montar_confirmacao_duplicata_lancamento,
  montar_confirmacao_exclusao,
  montar_confirmacao_exclusao_lancamento,
  montar_lista_lancamentos_semelhantes,
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

  it("lista numerada quando há vários semelhantes", () => {
    const texto = montar_confirmacao_exclusao_lancamento(
      "Tênis",
      "2026-08-05",
      609.4,
      2,
      null,
      [
        {
          id: "f41e31f0-1111-2222-3333-444455556666",
          descricao: "compra de um tênis para uso pessoal, um gasto pessoal",
          valor: 304.7,
          dataMovimento: "2026-08-05",
          dataLancamento: new Date("2026-08-05T17:32:00.000Z"),
          tipo: "despesa",
          origemRotulo: "Mercado Pago",
        },
        {
          id: "b30d16ce-1111-2222-3333-444455556666",
          descricao: "compra de um tênis para uso pessoal",
          valor: 304.7,
          dataMovimento: "2026-08-05",
          dataLancamento: new Date("2026-08-05T16:10:00.000Z"),
          tipo: "despesa",
          origemRotulo: "Mercado Pago",
        },
      ],
    );
    expect(texto).toContain("Encontrei 2 lançamentos:");
    expect(texto).toContain("1. compra de um tênis para uso pessoal, um gasto pessoal ·");
    expect(texto).toContain("2. compra de um tênis para uso pessoal ·");
    expect(texto).toContain("Qual deseja excluir (apagar)?");
    expect(texto).toContain('Digite o número (1, 2…) ou "todos"');
    expect(texto).not.toContain("#f41e31f0");
    expect(texto).not.toContain('Responda "sim"');
  });
});

describe("montar_lista_lancamentos_semelhantes", () => {
  it("usa verbo corrigir quando a ação é correção", () => {
    const texto = montar_lista_lancamentos_semelhantes(
      "Uber",
      [
        {
          id: "aaaaaaaa-1111-2222-3333-444455556666",
          descricao: "Uber",
          valor: 38.58,
          dataMovimento: "2026-08-05",
        },
        {
          id: "bbbbbbbb-1111-2222-3333-444455556666",
          descricao: "Uber",
          valor: 24.95,
          dataMovimento: "2026-08-05",
        },
      ],
      "corrigir",
    );
    expect(texto).toContain("1. Uber ·");
    expect(texto).toContain("2. Uber ·");
    expect(texto).toContain("Qual deseja corrigir (alterar — não apaga)?");
    expect(texto).toContain("Digite o número do lançamento");
    expect(texto).not.toContain("todos");
    expect(texto).not.toContain("excluir");
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
