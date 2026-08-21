import { describe, expect, it } from "vitest";
import {
  chave_classificacao_igual,
  eh_chave_classificacao_generica,
  movimento_igual_para_classificar,
} from "../iguais-classificacao";

describe("chave_classificacao_igual", () => {
  it("ignora caixa, acento, asterisco e índice de parcela", () => {
    expect(chave_classificacao_igual("UBER *TRIP")).toBe(chave_classificacao_igual("Uber Trip"));
    expect(chave_classificacao_igual("LATAM 1/3")).toBe(chave_classificacao_igual("Latâm"));
  });
});

describe("eh_chave_classificacao_generica", () => {
  it("recusa pix, ted e pagamento sozinhos", () => {
    expect(eh_chave_classificacao_generica("pix")).toBe(true);
    expect(eh_chave_classificacao_generica("pagamento")).toBe(true);
    expect(eh_chave_classificacao_generica("pix enviado")).toBe(true);
    expect(eh_chave_classificacao_generica("uber trip")).toBe(false);
  });
});

describe("movimento_igual_para_classificar", () => {
  it("casa a mesma linha do extrato", () => {
    expect(
      movimento_igual_para_classificar(
        { descricao: "Uber Trip", descricaoFonte: "UBER *TRIP" },
        { descricao: "UBER TRIP", descricaoFonte: "UBER *TRIP" },
      ),
    ).toBe(true);
  });

  it("não casa estabelecimento diferente", () => {
    expect(
      movimento_igual_para_classificar(
        { descricao: "iFood Loop", descricaoFonte: "IFOOD *LOOP" },
        { descricao: "iFood Pizza", descricaoFonte: "IFOOD *PIZZA" },
      ),
    ).toBe(false);
  });

  it("não casa pix genérico", () => {
    expect(
      movimento_igual_para_classificar(
        { descricao: "Pix", descricaoFonte: "PIX ENVIADO" },
        { descricao: "Pix", descricaoFonte: "PIX ENVIADO" },
      ),
    ).toBe(false);
  });
});
