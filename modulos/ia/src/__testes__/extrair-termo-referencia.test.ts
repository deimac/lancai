import { describe, expect, it } from "vitest";
import { extrair_termo_referencia_mensagem, preferir_termo_referencia } from "../extrair-termo-referencia";
import { rotulo_descricao_busca } from "../normalizar-descricao";

describe("extrair_termo_referencia_mensagem", () => {
  it("pega a palavra que o usuário escreveu", () => {
    expect(extrair_termo_referencia_mensagem("apague o lancamento de farmacia de hoje")).toBe(
      "Farmacia",
    );
    expect(extrair_termo_referencia_mensagem("cancela o almoço de ontem")).toBe("Almoço");
  });

  it("enxuga frase longa sem exigir texto idêntico ao cadastro", () => {
    expect(
      extrair_termo_referencia_mensagem("Apague lançamento compra de ténis para uso pessoal"),
    ).toBe("Ténis");
  });
});

describe("preferir_termo_referencia", () => {
  it("prefere a mensagem do usuário ao lixo da IA", () => {
    expect(
      preferir_termo_referencia(
        "apague o lancamento de farmacia de hoje",
        "farmaciarole ou farmacia farmacia",
      ),
    ).toBe("Farmacia");
  });
});

describe("rotulo_descricao_busca", () => {
  it("escolhe o termo curto quando a IA manda 'ou'", () => {
    expect(rotulo_descricao_busca("farmaciarole ou farmacia farmacia").toLowerCase()).toMatch(
      /farmacia/,
    );
  });
});
