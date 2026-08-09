import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cifrar_dados_plasticos,
  decifrar_dados_plasticos,
  extrair_final4,
  mascara_final4_do_payload,
  preparar_persistencia_plasticos,
  validar_dados_plasticos,
  validar_luhn,
} from "../cifragem-cartao";

describe("cifragem-cartao", () => {
  const chaveOriginal = process.env.CARTAO_DADOS_KEY;

  beforeEach(() => {
    process.env.CARTAO_DADOS_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  afterEach(() => {
    if (chaveOriginal === undefined) delete process.env.CARTAO_DADOS_KEY;
    else process.env.CARTAO_DADOS_KEY = chaveOriginal;
  });

  it("valida Luhn de um número conhecido", () => {
    expect(validar_luhn("4111111111111111")).toBe(true);
    expect(validar_luhn("4111111111111112")).toBe(false);
  });

  it("normaliza e valida dados plásticos", () => {
    expect(
      validar_dados_plasticos({
        numero: "4111 1111 1111 1111",
        validade: "08/30",
        cvv: "123",
      }),
    ).toEqual({
      numero: "4111111111111111",
      validade: "08/30",
      cvv: "123",
    });
  });

  it("cifra e decifra round-trip", () => {
    const dados = { numero: "4111111111111111", validade: "08/30", cvv: "123" };
    const cifrado = cifrar_dados_plasticos(dados);
    expect(cifrado).not.toContain("4111");
    expect(decifrar_dados_plasticos(cifrado)).toEqual(dados);
  });

  it("prepara persistência com final4", () => {
    const preparado = preparar_persistencia_plasticos({
      numero: "4111111111111111",
      validade: "8/2030",
      cvv: "123",
    });
    expect(preparado.final4).toBe("1111");
    expect(extrair_final4("4111111111111111")).toBe("1111");
    expect(decifrar_dados_plasticos(preparado.dadosPlasticosCifrados).validade).toBe("08/30");
  });

  it("deriva máscara final4 a partir do blob cifrado", () => {
    const preparado = preparar_persistencia_plasticos({
      numero: "4111111111111111",
      validade: "08/30",
      cvv: "123",
    });
    expect(mascara_final4_do_payload(preparado.dadosPlasticosCifrados)).toBe("1111");
    expect(mascara_final4_do_payload(null)).toBeNull();
    expect(mascara_final4_do_payload("payload-invalido")).toBeNull();
  });
});
