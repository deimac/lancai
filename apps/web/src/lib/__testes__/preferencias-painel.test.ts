import { afterEach, describe, expect, it } from "vitest";
import {
  ALTURA_PAINEL_MIN,
  LARGURA_PAINEL_MIN,
  LARGURA_PAINEL_PADRAO,
  altura_painel_padrao,
  ler_altura_painel,
  ler_largura_painel,
  ler_painel_maximizado,
  limitar_altura_painel,
  limitar_largura_painel,
  salvar_altura_painel,
  salvar_largura_painel,
  salvar_painel_maximizado,
} from "../preferencias-painel";

const memoria = new Map<string, string>();

const armazenamento = {
  getItem(chave: string) {
    return memoria.get(chave) ?? null;
  },
  setItem(chave: string, valor: string) {
    memoria.set(chave, valor);
  },
  removeItem(chave: string) {
    memoria.delete(chave);
  },
  clear() {
    memoria.clear();
  },
  key() {
    return null;
  },
  get length() {
    return memoria.size;
  },
};

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: armazenamento,
});

afterEach(() => {
  memoria.clear();
});

describe("tamanho do painel do assistente", () => {
  it("clampa a largura para caber o conteúdo ao lado", () => {
    expect(limitar_largura_painel(200, 1200)).toBe(LARGURA_PAINEL_MIN);
    expect(limitar_largura_painel(2000, 1200)).toBe(1152);
    expect(limitar_largura_painel(400, 1200)).toBe(400);
  });

  it("clampa a altura para não cobrir o conteúdo acima", () => {
    expect(limitar_altura_painel(100, 800)).toBe(ALTURA_PAINEL_MIN);
    expect(limitar_altura_painel(900, 800)).toBe(752);
  });

  it("altura padrão é ~42% da viewport, no mínimo o piso", () => {
    expect(altura_painel_padrao(1000)).toBe(420);
    expect(altura_painel_padrao(400)).toBe(ALTURA_PAINEL_MIN);
  });

  it("persiste largura, altura e maximizado", () => {
    expect(ler_largura_painel()).toBe(LARGURA_PAINEL_PADRAO);
    salvar_largura_painel(512);
    expect(ler_largura_painel()).toBe(512);

    salvar_altura_painel(360);
    expect(ler_altura_painel(1000)).toBe(360);

    expect(ler_painel_maximizado()).toBe(false);
    salvar_painel_maximizado(true);
    expect(ler_painel_maximizado()).toBe(true);
  });
});
