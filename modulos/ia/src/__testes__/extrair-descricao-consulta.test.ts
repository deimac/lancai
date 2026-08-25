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
  });

  it("reconhece recebi de", () => {
    expect(extrair_contraparte_recebimento("quanto recebi de Tayna Santos de pix?")).toBe(
      "Tayna Santos",
    );
  });

  it("não trata pix como nome", () => {
    expect(extrair_contraparte_recebimento("quanto eu enviei de pix ontem?")).toBeNull();
  });
});
