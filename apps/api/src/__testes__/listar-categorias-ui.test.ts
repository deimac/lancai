import { describe, expect, it } from "vitest";
import { mapa_fechamento_cartoes } from "@lancai/tipos";
import {
  agregar_totais_por_categoria,
  data_referencia_do_mes,
} from "../servicos/listar-categorias-ui";
import { gasto_do_orcamento } from "../servicos/orcamento-servico";

describe("data_referencia_do_mes", () => {
  it("converte YYYY-MM em YYYY-MM-01 e ignora valor inválido", () => {
    expect(data_referencia_do_mes("2026-08")).toBe("2026-08-01");
    expect(data_referencia_do_mes("2026-13", "2026-04-09")).toBe("2026-04-09");
    expect(data_referencia_do_mes(undefined, "2026-04-09")).toBe("2026-04-09");
  });
});

describe("agregar_totais_por_categoria", () => {
  it("no histórico, compra pós-fechamento entra no mês em que a fatura fecha", () => {
    const fechamentoPorCartao = mapa_fechamento_cartoes([{ id: "mp", fechamento: 12 }]);
    const movimentos = [
      {
        dataMovimento: "2026-08-25",
        cartaoId: "mp",
        categoriaId: "cat",
        tipo: "despesa" as const,
        valor: "970.76",
        status: "previsto",
      },
    ];
    const limite = 800;
    const hoje = "2026-10-15";

    const agosto = agregar_totais_por_categoria(movimentos, "2026-08", fechamentoPorCartao, new Map(), hoje);
    const setembro = agregar_totais_por_categoria(movimentos, "2026-09", fechamentoPorCartao, new Map(), hoje);

    expect(agosto.get("cat")).toBeUndefined();
    expect(setembro.get("cat")).toEqual({ saidas: 970.76, entradas: 0, quantidade: 1 });

    const gastoAgo = gasto_do_orcamento("despesa", agosto.get("cat")?.saidas ?? 0, 0);
    const gastoSet = gasto_do_orcamento("despesa", setembro.get("cat")?.saidas ?? 0, 0);
    expect((gastoAgo / limite) * 100).toBe(0);
    expect((gastoSet / limite) * 100).toBeCloseTo(121.345, 3);
  });

  it("no mês atual, compra pós-fechamento entra na fatura aberta", () => {
    const fechamentoPorCartao = mapa_fechamento_cartoes([{ id: "mp", fechamento: 12 }]);
    const movimentos = [
      {
        dataMovimento: "2026-08-25",
        cartaoId: "mp",
        categoriaId: "cat",
        tipo: "despesa" as const,
        valor: "970.76",
        status: "previsto",
      },
    ];

    const agostoAberto = agregar_totais_por_categoria(
      movimentos,
      "2026-08",
      fechamentoPorCartao,
      new Map(),
      "2026-08-31",
    );
    expect(agostoAberto.get("cat")).toEqual({ saidas: 970.76, entradas: 0, quantidade: 1 });
  });
});
