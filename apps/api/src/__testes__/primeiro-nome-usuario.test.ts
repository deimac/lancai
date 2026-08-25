import { describe, expect, it } from "vitest";
import { primeiroNomeVocativo } from "../servicos/primeiro-nome-usuario";

describe("primeiroNomeVocativo", () => {
  it("pega o primeiro token de um nome de pessoa", () => {
    expect(primeiroNomeVocativo("Ana Silva")).toBe("Ana");
    expect(primeiroNomeVocativo("Deividy")).toBe("Deividy");
  });

  it("não vocativa razão social", () => {
    expect(primeiroNomeVocativo("FOCCUM LTDA")).toBeUndefined();
    expect(primeiroNomeVocativo("Empresa ME")).toBeUndefined();
    expect(primeiroNomeVocativo("Acme S.A.")).toBeUndefined();
    expect(primeiroNomeVocativo("João EIRELI")).toBeUndefined();
  });
});
