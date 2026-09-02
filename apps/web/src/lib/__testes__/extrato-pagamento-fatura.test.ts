import { describe, expect, it } from "vitest";
import {
  competencia_default_fatura,
  modo_convite_pagamento_fatura,
  mostra_acao_pagamento_fatura,
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
    expect(mostra_acao_pagamento_fatura(creditoCartao)).toBe(true);
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
    expect(mostra_acao_pagamento_fatura(marcado)).toBe(true);
    expect(
      modo_convite_pagamento_fatura({
        movimento: marcado,
        temSugestao: true,
        dispensou: true,
      }),
    ).toBe("marcado");
  });

  it("entrada na conta não oferece marcar, mas desmarca se já estiver como fatura", () => {
    const entrada = {
      tipo: "receita" as const,
      contaId: "conta",
      cartaoId: null,
      status: "realizado" as const,
      papel: "gasto" as const,
    };
    expect(mostra_check_pagamento_fatura(entrada)).toBe(false);
    expect(mostra_acao_pagamento_fatura(entrada)).toBe(false);
    expect(
      mostra_acao_pagamento_fatura({ ...entrada, papel: "pagamento_fatura" }),
    ).toBe(true);
  });

  it("compra no cartão só ganha o item do menu se já estiver marcada errado", () => {
    const compra = {
      tipo: "despesa" as const,
      contaId: null,
      cartaoId: "cartao",
      status: "realizado" as const,
      papel: "gasto" as const,
    };
    expect(mostra_acao_pagamento_fatura(compra)).toBe(false);
    expect(mostra_acao_pagamento_fatura({ ...compra, papel: "pagamento_fatura" })).toBe(true);
  });

  it("pré-preenche o mês do vencimento no Azul (fecha 30 vence 6)", () => {
    expect(
      competencia_default_fatura(
        { dataMovimento: "2026-06-01", competenciaFatura: null },
        { fechamento: 30, vencimento: 6 },
      ),
    ).toBe("2026-06");
    expect(
      competencia_default_fatura(
        { dataMovimento: "2026-07-29", competenciaFatura: null },
        { fechamento: 30, vencimento: 6 },
      ),
    ).toBe("2026-08");
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
