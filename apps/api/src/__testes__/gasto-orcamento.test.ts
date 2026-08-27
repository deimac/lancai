import { describe, expect, it } from "vitest";
import { gasto_do_orcamento, somar_gastos_dos_movimentos } from "../servicos/orcamento-servico";
import { mapa_fechamento_cartoes } from "@lancai/tipos";

describe("gasto_do_orcamento", () => {
  it("em categoria ambos faz saldo de saídas menos entradas", () => {
    expect(gasto_do_orcamento("ambos", 500, 200)).toBe(300);
    expect(gasto_do_orcamento("ambos", 200, 500)).toBe(-300);
    expect(gasto_do_orcamento("ambos", 90.555, 20.111)).toBe(70.44);
  });

  it("em despesa, receita ou teto geral ignora entradas", () => {
    expect(gasto_do_orcamento("despesa", 500, 200)).toBe(500);
    expect(gasto_do_orcamento("receita", 0, 800)).toBe(0);
    expect(gasto_do_orcamento(null, 500, 200)).toBe(500);
  });

  it("reduz o percentual do limite quando a entrada abate a saída", () => {
    const limite = 400;
    const gasto = gasto_do_orcamento("ambos", 500, 200);
    expect((gasto / limite) * 100).toBe(75);
  });
});

describe("somar_gastos_dos_movimentos", () => {
  it("cartão depois do fechamento conta no mês da fatura", () => {
    const fechamentoPorCartao = mapa_fechamento_cartoes([{ id: "mp", fechamento: 12 }]);
    const movimentos = [
      {
        dataMovimento: "2026-08-25",
        cartaoId: "mp",
        categoriaId: "cat",
        tipo: "despesa",
        valor: "970.76",
        tipoGasto: "pj",
        status: "previsto",
      },
    ];
    expect(
      somar_gastos_dos_movimentos(movimentos, { mes: "2026-08", fechamentoPorCartao, categoriaId: "cat" }),
    ).toEqual({ saidas: 0, entradas: 0 });
    expect(
      somar_gastos_dos_movimentos(movimentos, { mes: "2026-09", fechamentoPorCartao, categoriaId: "cat" }),
    ).toEqual({ saidas: 970.76, entradas: 0 });
  });
});
