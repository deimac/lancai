import { afterEach, describe, expect, it } from "vitest";
import {
  dispensar_convite_fatura,
  ler_faturas_dispensadas,
} from "../preferencias-fatura-dispensada";

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

describe("preferencias-fatura-dispensada", () => {
  it("persiste o X e não devolve o convite no mesmo movimento", () => {
    const usuarioId = "usuario-1";
    const movimentoId = "mov-abc";

    expect(ler_faturas_dispensadas(usuarioId).has(movimentoId)).toBe(false);

    const depois = dispensar_convite_fatura(usuarioId, movimentoId, new Set());
    expect(depois.has(movimentoId)).toBe(true);
    expect(ler_faturas_dispensadas(usuarioId).has(movimentoId)).toBe(true);
  });

  it("não mistura dispensas de outro usuário", () => {
    dispensar_convite_fatura("usuario-1", "mov-abc", new Set());
    expect(ler_faturas_dispensadas("usuario-2").has("mov-abc")).toBe(false);
  });
});
