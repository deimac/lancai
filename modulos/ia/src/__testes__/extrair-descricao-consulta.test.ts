import { describe, expect, it } from "vitest";
import { extrair_contraparte_recebimento } from "../extrair-descricao-consulta";

describe("extrair_contraparte_recebimento", () => {
  it("tira o nome de quem enviou o Pix", () => {
    expect(extrair_contraparte_recebimento("quanto a tayna santos me enviou de pix?")).toBe(
      "tayna santos",
    );
    expect(extrair_contraparte_recebimento("quanto a Tayna Santos me enviou de pix?")).toBe(
      "Tayna Santos",
    );
    expect(extrair_contraparte_recebimento("quanto o João me enviou de pix?")).toBe("João");
  });

  it("reconhece recebi de", () => {
    expect(extrair_contraparte_recebimento("quanto recebi de Tayna Santos de pix?")).toBe(
      "Tayna Santos",
    );
  });

  it("não mistura pix no nome em recebi de pix da pessoa", () => {
    expect(extrair_contraparte_recebimento("quanto recebi de pix da Tayna Santos?")).toBe(
      "Tayna Santos",
    );
    expect(extrair_contraparte_recebimento("quanto recebi pix da Tayna Santos?")).toBe(
      "Tayna Santos",
    );
    expect(extrair_contraparte_recebimento("quanto recebi um pix da Tayna Santos?")).toBe(
      "Tayna Santos",
    );
    expect(extrair_contraparte_recebimento("quanto recebi de pix do João?")).toBe("João");
    expect(extrair_contraparte_recebimento("quanto recebi de pix da Maria Silva?")).toBe(
      "Maria Silva",
    );
  });

  it("não trata pix como nome", () => {
    expect(extrair_contraparte_recebimento("quanto eu enviei de pix ontem?")).toBeNull();
    expect(extrair_contraparte_recebimento("quanto recebi de pix ontem?")).toBeNull();
  });
});
