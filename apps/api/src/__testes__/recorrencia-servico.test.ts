import { describe, expect, it } from "vitest";
import { ja_existe_cobranca_equivalente } from "../servicos/recorrencia-servico";

function cobranca(
  sobrepor: Partial<Parameters<typeof ja_existe_cobranca_equivalente>[0]["movimentos"][number]> = {},
) {
  return {
    descricao: "NETFLIX.COM",
    descricaoFonte: "NETFLIX.COM",
    favorecidoFonte: null as string | null,
    valor: "55.90",
    tipo: "despesa",
    contaId: "conta-1",
    cartaoId: null as string | null,
    status: "realizado",
    fonte: "open_finance",
    ...sobrepor,
  };
}

describe("ja_existe_cobranca_equivalente", () => {
  const netflix = {
    descricao: "Netflix",
    valor: 55.9,
    tipo: "despesa",
    contaId: "conta-1",
    cartaoId: null as string | null,
  };

  it("reconhece Fato OF do mesmo mês, conta, valor e descrição", () => {
    expect(
      ja_existe_cobranca_equivalente({
        ...netflix,
        movimentos: [cobranca()],
      }),
    ).toBe(true);
  });

  it("não casa valor diferente", () => {
    expect(
      ja_existe_cobranca_equivalente({
        ...netflix,
        movimentos: [cobranca({ valor: "39.90" })],
      }),
    ).toBe(false);
  });

  it("não casa conta diferente", () => {
    expect(
      ja_existe_cobranca_equivalente({
        ...netflix,
        movimentos: [cobranca({ contaId: "conta-2" })],
      }),
    ).toBe(false);
  });

  it("ignora o próprio lançamento gerado pela recorrência", () => {
    expect(
      ja_existe_cobranca_equivalente({
        ...netflix,
        movimentos: [cobranca({ fonte: "recorrencia", descricao: "Netflix", descricaoFonte: "Netflix" })],
      }),
    ).toBe(false);
  });

  it("ignora cancelado", () => {
    expect(
      ja_existe_cobranca_equivalente({
        ...netflix,
        movimentos: [cobranca({ status: "cancelado" })],
      }),
    ).toBe(false);
  });
});
