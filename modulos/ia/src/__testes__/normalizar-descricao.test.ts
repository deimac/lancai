import { describe, expect, it } from "vitest";
import {
  descricao_corresponde_busca,
  normalizar_descricao,
  rotulo_descricao_busca,
} from "../normalizar-descricao";

describe("normalizar_descricao", () => {
  it("ignora caixa e acentos", () => {
    expect(normalizar_descricao("Farmácia")).toBe(normalizar_descricao("farmacia"));
    expect(normalizar_descricao("Farmacia")).toBe(normalizar_descricao("FARMACIA"));
  });

  it("colapsa espaços", () => {
    expect(normalizar_descricao("  Farmácia  drogaria ")).toBe("farmacia drogaria");
  });
});

describe("descricao_corresponde_busca", () => {
  it("casa Farmácia com farmacia e alternativas da IA", () => {
    expect(descricao_corresponde_busca("Farmácia", "farmacia")).toBe(true);
    expect(descricao_corresponde_busca("farmacia", "Farmácia漂/Farmacia/farmacia")).toBe(true);
  });
});

describe("rotulo_descricao_busca", () => {
  it("pega um termo legível sem lixo da IA", () => {
    expect(rotulo_descricao_busca("Farmácia漂/Farmacia/farmacia").toLowerCase()).toMatch(/farmacia/);
  });
});
