import { describe, expect, it } from "vitest";
import { formatarMoeda } from "@lancai/tipos";
import { montar_lista_lancamentos_semelhantes } from "../montar-lista-semelhantes";

describe("montar_lista_lancamentos_semelhantes", () => {
  it("numera itens sem #código e pede número ou todos", () => {
    const texto = montar_lista_lancamentos_semelhantes(
      "Tênis",
      [
        {
          id: "f41e31f0-1111-2222-3333-444455556666",
          descricao: "compra de um tênis para uso pessoal",
          valor: 304.7,
          dataMovimento: "2026-08-05",
          tipo: "despesa",
          origemRotulo: "Mercado Pago",
        },
        {
          id: "b30d16ce-1111-2222-3333-444455556666",
          descricao: "compra de um tênis para uso pessoal, um gasto pessoal",
          valor: 304.7,
          dataMovimento: "2026-08-05",
          tipo: "despesa",
          origemRotulo: "Mercado Pago",
        },
      ],
      "excluir",
    );
    expect(texto).toContain('Encontrei 2 lançamentos semelhantes a "Tênis":');
    expect(texto).toContain(`1. - ${formatarMoeda(304.7)} · 05/08/2026 · Mercado Pago · mais recente`);
    expect(texto).toContain(`2. - ${formatarMoeda(304.7)} · 05/08/2026 · Mercado Pago · mais antigo`);
    expect(texto).toContain('Digite o número (1, 2…) ou "todos"');
    expect(texto).not.toContain("#f41e31f0");
    expect(texto).not.toMatch(/\bTênis\b.*Tênis/); // não repete descrição enxugada igual nas linhas
  });

  it("mostra descrição quando os núcleos diferem", () => {
    const texto = montar_lista_lancamentos_semelhantes(
      "gasto",
      [
        {
          id: "aaaaaaaa-1111-2222-3333-444455556666",
          descricao: "Uber",
          valor: 38.58,
          dataMovimento: "2026-08-05",
          origemRotulo: "cartão Azul",
        },
        {
          id: "bbbbbbbb-1111-2222-3333-444455556666",
          descricao: "Farmácia",
          valor: 24.95,
          dataMovimento: "2026-08-05",
          origemRotulo: "cartão Azul",
        },
      ],
      "corrigir",
    );
    expect(texto).toContain("1. Uber ·");
    expect(texto).toContain("2. Farmácia ·");
    expect(texto).toContain("Digite o número do lançamento");
    expect(texto).not.toContain("todos");
  });
});
