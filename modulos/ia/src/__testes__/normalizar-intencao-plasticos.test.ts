import { describe, expect, it } from "vitest";
import { extrair_dados_plasticos_da_mensagem } from "../cifragem-cartao";
import { normalizar_intencao_plasticos } from "../normalizar-intencao-plasticos";

describe("extrair_dados_plasticos_da_mensagem", () => {
  it("extrai número, validade e CVV da frase do usuário", () => {
    expect(
      extrair_dados_plasticos_da_mensagem(
        "adicione os dados do cartao Itau, 4783 0804 0622 9275, validade 11/32, cvv 443",
      ),
    ).toEqual({
      numero: "4783080406229275",
      validade: "11/32",
      cvv: "443",
    });
  });
});

describe("normalizar_intencao_plasticos", () => {
  it("completa campos faltantes em CORRIGIR_CARTAO a partir da mensagem", () => {
    const resultado = normalizar_intencao_plasticos(
      {
        intencao: "CORRIGIR_CARTAO",
        cartao_nome: "Azul Itaú",
        campos_alterados: {
          numero: "4783 0804 0622 9275",
        },
      },
      "adicione os dados do cartao Itau, 4783 0804 0622 9275, validade 11/32, cvv 443",
    );

    expect(resultado).toMatchObject({
      intencao: "CORRIGIR_CARTAO",
      campos_alterados: {
        numero: "4783 0804 0622 9275",
        validade: "11/32",
        cvv: "443",
      },
    });
  });

  it("preenche os três campos quando a IA não mandou nenhum", () => {
    const resultado = normalizar_intencao_plasticos(
      {
        intencao: "CORRIGIR_CARTAO",
        cartao_nome: "Itaú",
        campos_alterados: {},
      },
      "salva o número do cartão Itaú: 4783 0804 0622 9275 validade 11/32 cvv 443",
    );

    expect(resultado).toMatchObject({
      campos_alterados: {
        numero: "4783080406229275",
        validade: "11/32",
        cvv: "443",
      },
    });
  });
});
