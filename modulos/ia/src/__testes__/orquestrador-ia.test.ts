import { afterEach, describe, expect, it } from "vitest";
import {
  obter_ordem_fallback_do_ambiente,
  PROVEDORES_IA,
  resetar_circuitos_provedores,
} from "../orquestrador-ia";

describe("obter_ordem_fallback_do_ambiente", () => {
  const envOriginal = { ...process.env };

  afterEach(() => {
    process.env = { ...envOriginal };
    resetar_circuitos_provedores();
  });

  it("usa ordem padrão com groq → gemini → ollama primeiro", () => {
    delete process.env.LLM_ORDEM_FALLBACK;
    delete process.env.LLM_PROVEDOR_PADRAO;
    expect(PROVEDORES_IA.slice(0, 3)).toEqual(["groq", "gemini", "ollama"]);
    expect(obter_ordem_fallback_do_ambiente()[0]).toBe("groq");
  });

  it("respeita LLM_PROVEDOR_PADRAO e LLM_ORDEM_FALLBACK", () => {
    process.env.LLM_ORDEM_FALLBACK = "groq,gemini,ollama";
    process.env.LLM_PROVEDOR_PADRAO = "gemini";
    expect(obter_ordem_fallback_do_ambiente()).toEqual(["gemini", "groq", "ollama"]);
  });
});
