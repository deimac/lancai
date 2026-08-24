import { describe, expect, it } from "vitest";
import { formatarMoeda } from "@lancai/tipos";
import { montar_lista_lancamentos_semelhantes } from "../montar-lista-semelhantes";

describe("montar_lista_lancamentos_semelhantes", () => {
  it("numera com descrição original e a data do Fato", () => {
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
    expect(texto).toContain("Encontrei 2 lançamentos:");
    expect(texto).toContain(
      `1. compra de um tênis para uso pessoal · - ${formatarMoeda(304.7)} · 05/08/2026 · Mercado Pago`,
    );
    expect(texto).toContain(
      `2. compra de um tênis para uso pessoal, um gasto pessoal · - ${formatarMoeda(304.7)} · 05/08/2026 · Mercado Pago`,
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
    expect(texto).toContain("05/08/2026");
    expect(texto).toContain("2. Farmácia ·");
    expect(texto).toContain("Qual deseja corrigir (alterar — não apaga)?");
    expect(texto).toContain("Digite o número do lançamento");
  });

  it("mostra o dia da fatura, não o dia em que o PDF foi importado", () => {
    const texto = montar_lista_lancamentos_semelhantes(
      "Tarifa",
      [
        {
          id: "aaaaaaaa-1111-2222-3333-444455556666",
          descricao: "Tarifa ad. mensal do cartão de crédito",
          valor: 9.99,
          dataMovimento: "2026-07-10",
          tipo: "despesa",
          origemRotulo: "cartão Revolut Visa",
        },
      ],
      "corrigir",
    );
    expect(texto).toContain("10/07/2026");
    expect(texto).not.toContain("23/08/2026");
  });

  it("anexa a hora da instituição e ignora meia-noite (só o dia)", () => {
    const comHora = montar_lista_lancamentos_semelhantes(
      "Uber",
      [
        {
          id: "aaaaaaaa-1111-2222-3333-444455556666",
          descricao: "Uber",
          valor: 38.58,
          dataMovimento: "2026-08-05",
          ocorridoEmInstante: new Date("2026-08-05T17:32:00.000Z"),
        },
      ],
      "corrigir",
    );
    expect(comHora).toContain("05/08/2026 14:32");

    const soDia = montar_lista_lancamentos_semelhantes(
      "Tarifa",
      [
        {
          id: "bbbbbbbb-1111-2222-3333-444455556666",
          descricao: "Tarifa",
          valor: 9.99,
          dataMovimento: "2026-07-10",
          ocorridoEmInstante: new Date("2026-07-10T00:00:00.000Z"),
        },
      ],
      "corrigir",
    );
    expect(soDia).toContain("10/07/2026");
    expect(soDia).not.toContain("00:00");
  });
});
