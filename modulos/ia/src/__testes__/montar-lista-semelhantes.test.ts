import { describe, expect, it } from "vitest";
import { formatarMoeda } from "@lancai/tipos";
import { montar_lista_lancamentos_semelhantes } from "../montar-lista-semelhantes";

describe("montar_lista_lancamentos_semelhantes", () => {
  it("numera com descrição original e horário do lançamento", () => {
    const texto = montar_lista_lancamentos_semelhantes(
      "Tênis",
      [
        {
          id: "f41e31f0-1111-2222-3333-444455556666",
          descricao: "compra de um tênis para uso pessoal",
          valor: 304.7,
          dataMovimento: "2026-08-05",
          dataLancamento: new Date("2026-08-05T17:32:00.000Z"),
          tipo: "despesa",
          origemRotulo: "Mercado Pago",
        },
        {
          id: "b30d16ce-1111-2222-3333-444455556666",
          descricao: "compra de um tênis para uso pessoal, um gasto pessoal",
          valor: 304.7,
          dataMovimento: "2026-08-05",
          dataLancamento: new Date("2026-08-05T16:10:00.000Z"),
          tipo: "despesa",
          origemRotulo: "Mercado Pago",
        },
      ],
      "excluir",
    );
    expect(texto).toContain("Encontrei 2 lançamentos:");
    expect(texto).toContain(
      `1. compra de um tênis para uso pessoal · - ${formatarMoeda(304.7)} · 05/08/2026 14:32 · Mercado Pago`,
    );
    expect(texto).toContain(
      `2. compra de um tênis para uso pessoal, um gasto pessoal · - ${formatarMoeda(304.7)} · 05/08/2026 13:10 · Mercado Pago`,
    );
    expect(texto).not.toContain("mais recente");
    expect(texto).not.toContain("mais antigo");
    expect(texto).not.toContain("#f41e31f0");
  });

  it("mantém descrições distintas na correção", () => {
    const texto = montar_lista_lancamentos_semelhantes(
      "gasto",
      [
        {
          id: "aaaaaaaa-1111-2222-3333-444455556666",
          descricao: "Uber",
          valor: 38.58,
          dataMovimento: "2026-08-05",
          dataLancamento: new Date("2026-08-05T15:00:00.000Z"),
          origemRotulo: "cartão Azul",
        },
        {
          id: "bbbbbbbb-1111-2222-3333-444455556666",
          descricao: "Farmácia",
          valor: 24.95,
          dataMovimento: "2026-08-05",
          dataLancamento: new Date("2026-08-05T14:00:00.000Z"),
          origemRotulo: "cartão Azul",
        },
      ],
      "corrigir",
    );
    expect(texto).toContain("1. Uber ·");
    expect(texto).toContain("12:00");
    expect(texto).toContain("2. Farmácia ·");
    expect(texto).toContain("Qual deseja corrigir (alterar — não apaga)?");
    expect(texto).toContain("Digite o número do lançamento");
  });
});
