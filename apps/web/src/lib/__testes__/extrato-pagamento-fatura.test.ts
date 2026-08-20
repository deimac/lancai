import { describe, expect, it } from "vitest";
import {
  modo_convite_pagamento_fatura,
  mostra_check_pagamento_fatura,
} from "../extrato-pagamento-fatura";

const conta = {
  tipo: "despesa" as const,
  contaId: "conta",
  cartaoId: null,
  status: "realizado" as const,
  papel: "gasto" as const,
};

const creditoCartao = {
  tipo: "receita" as const,
  contaId: null,
  cartaoId: "cartao",
  status: "realizado" as const,
  papel: "gasto" as const,
};

describe("modo_convite_pagamento_fatura", () => {
  it("com sugestão mostra só o banner, sem o check genérico", () => {
    expect(
      modo_convite_pagamento_fatura({
        movimento: creditoCartao,
        temSugestao: true,
        dispensou: false,
      }),
    ).toBe("banner");
  });

  it("sem sugestão mostra só o check", () => {
    expect(
      modo_convite_pagamento_fatura({
        movimento: conta,
        temSugestao: false,
        dispensou: false,
      }),
    ).toBe("check");
  });

  it("depois do X some o convite e não volta naquele movimento", () => {
    expect(
      modo_convite_pagamento_fatura({
        movimento: creditoCartao,
        temSugestao: true,
        dispensou: true,
      }),
    ).toBe("nada");
  });

  it("já marcado continua com check e campos", () => {
    expect(
      modo_convite_pagamento_fatura({
        movimento: { ...creditoCartao, papel: "pagamento_fatura" },
        temSugestao: true,
        dispensou: false,
      }),
    ).toBe("marcado");
  });

  it("depois do X o menu ainda oferece marcar pagamento de fatura", () => {
    expect(mostra_check_pagamento_fatura(creditoCartao)).toBe(true);
    expect(
      modo_convite_pagamento_fatura({
        movimento: creditoCartao,
        temSugestao: true,
        dispensou: true,
      }),
    ).toBe("nada");
  });

  it("já marcado como fatura continua disponível para desmarcar no menu", () => {
    const marcado = { ...creditoCartao, papel: "pagamento_fatura" as const };
    expect(mostra_check_pagamento_fatura(marcado)).toBe(true);
    expect(
      modo_convite_pagamento_fatura({
        movimento: marcado,
        temSugestao: true,
        dispensou: true,
      }),
    ).toBe("marcado");
  });

  it("não oferece convite em compra no cartão", () => {
    const compra = {
      tipo: "despesa" as const,
      contaId: null,
      cartaoId: "cartao",
      status: "realizado" as const,
      papel: "gasto" as const,
    };
    expect(mostra_check_pagamento_fatura(compra)).toBe(false);
    expect(
      modo_convite_pagamento_fatura({
        movimento: compra,
        temSugestao: true,
        dispensou: false,
      }),
    ).toBe("nada");
  });
});
