import { describe, expect, it } from "vitest";
import {
  chave_descricao_lancamento,
  descricao_corresponde_busca,
  enxugar_descricao_lancamento,
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

describe("enxugar_descricao_lancamento", () => {
  it("reduz frase longa a núcleo do bem", () => {
    expect(enxugar_descricao_lancamento("compra de um tênis para uso pessoal, um gasto pessoal")).toBe(
      "Tênis",
    );
  });

  it("mantém estabelecimento curto", () => {
    expect(enxugar_descricao_lancamento("Uber")).toBe("Uber");
  });

  it("chave canônica iguala variações com fluff", () => {
    expect(
      chave_descricao_lancamento("compra de um tênis para uso pessoal, um gasto pessoal"),
    ).toBe(chave_descricao_lancamento("compra de um tênis para uso pessoal"));
  });
});

describe("descricao_corresponde_busca", () => {
  it("casa Farmácia com farmacia e alternativas da IA", () => {
    expect(descricao_corresponde_busca("Farmácia", "farmacia")).toBe(true);
    expect(descricao_corresponde_busca("farmacia", "Farmácia漂/Farmacia/farmacia")).toBe(true);
  });

  it("casa cadastro longo com termo curto do usuário", () => {
    expect(
      descricao_corresponde_busca(
        "compra de um tênis para uso pessoal, um gasto pessoal",
        "Ténis",
      ),
    ).toBe(true);
    expect(
      descricao_corresponde_busca(
        "compra de um tênis para uso pessoal",
        "compra de ténis para uso pessoal",
      ),
    ).toBe(true);
    expect(descricao_corresponde_busca("Tênis", "Apague o tênis")).toBe(true);
  });
});

describe("rotulo_descricao_busca", () => {
  it("pega um termo legível sem lixo da IA", () => {
    expect(rotulo_descricao_busca("Farmácia漂/Farmacia/farmacia").toLowerCase()).toMatch(/farmacia/);
  });
});
