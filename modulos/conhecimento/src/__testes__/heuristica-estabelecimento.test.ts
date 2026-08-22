import { describe, expect, it } from "vitest";
import { sugerir_nome_categoria_estabelecimento } from "../heuristica-estabelecimento";

describe("sugerir_nome_categoria_estabelecimento", () => {
  it("casa estabelecimentos comuns da fatura com a categoria padrão", () => {
    expect(sugerir_nome_categoria_estabelecimento("Card Payment to UBER")).toBe("Transporte");
    expect(sugerir_nome_categoria_estabelecimento("IFOOD")).toBe("Alimentação");
    expect(sugerir_nome_categoria_estabelecimento("SPOTIFY")).toBe("Assinaturas");
    expect(sugerir_nome_categoria_estabelecimento("POSTO SHELL")).toBe("Combustível");
    expect(sugerir_nome_categoria_estabelecimento("DROGASIL CENTRO")).toBe("Saúde");
  });

  it("não chuta estabelecimento desconhecido", () => {
    expect(sugerir_nome_categoria_estabelecimento("LOJA XYZ 9921")).toBeNull();
    expect(sugerir_nome_categoria_estabelecimento("From MARIA SILVA")).toBeNull();
  });
});
