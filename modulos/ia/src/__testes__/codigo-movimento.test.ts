import { describe, expect, it } from "vitest";
import {
  codigo_curto_movimento,
  extrair_codigo_da_mensagem,
  formatar_codigo_movimento,
} from "../codigo-movimento";

describe("codigo_movimento", () => {
  it("gera código curto de 8 hex", () => {
    expect(codigo_curto_movimento("a1b2c3d4-1111-2222-3333-444455556666")).toBe("a1b2c3d4");
    expect(formatar_codigo_movimento("a1b2c3d4-1111-2222-3333-444455556666")).toBe("#a1b2c3d4");
  });

  it("extrai código da mensagem", () => {
    expect(extrair_codigo_da_mensagem("cancela o #a1b2c3d4")).toBe("a1b2c3d4");
    expect(extrair_codigo_da_mensagem("apaga a1b2c3d4-1111-2222-3333-444455556666")).toBe(
      "a1b2c3d4",
    );
  });
});
