import { afterEach, describe, expect, it } from "vitest";
import {
  gemini_no_fallback,
  obter_ordem_fallback_do_ambiente,
  ollama_habilitado,
  PROVEDORES_IA,
  resetar_circuitos_provedores,
} from "../orquestrador-ia";

describe("obter_ordem_fallback_do_ambiente", () => {
  const envOriginal = { ...process.env };

  afterEach(() => {
    process.env = { ...envOriginal };
    resetar_circuitos_provedores();
  });

  it("usa ordem padrão com groq primeiro (sem gemini por padrão)", () => {
    delete process.env.LLM_ORDEM_FALLBACK;
    delete process.env.LLM_PROVEDOR_PADRAO;
    delete process.env.LLM_FALLBACK_GEMINI;
    process.env.GROQ_API_KEY = "gsk_test";
    expect(PROVEDORES_IA.slice(0, 3)).toEqual(["groq", "gemini", "ollama"]);
    expect(obter_ordem_fallback_do_ambiente()[0]).toBe("groq");
    expect(obter_ordem_fallback_do_ambiente()).not.toContain("gemini");
  });

  it("com GROQ_API_KEY, remove gemini mesmo se estiver em LLM_ORDEM_FALLBACK", () => {
    process.env.GROQ_API_KEY = "gsk_test";
    process.env.LLM_ORDEM_FALLBACK = "groq,gemini,ollama";
    delete process.env.LLM_FALLBACK_GEMINI;
    expect(obter_ordem_fallback_do_ambiente()).toEqual(["groq", "ollama"]);
  });

  it("inclui gemini só com LLM_FALLBACK_GEMINI=true", () => {
    process.env.GROQ_API_KEY = "gsk_test";
    process.env.LLM_ORDEM_FALLBACK = "groq,gemini";
    process.env.LLM_FALLBACK_GEMINI = "true";
    expect(obter_ordem_fallback_do_ambiente()).toEqual(["groq", "gemini"]);
    expect(gemini_no_fallback()).toBe(true);
  });

  it("normaliza maiúsculas e espaços e mantém groq na frente", () => {
    process.env.GROQ_API_KEY = "gsk_test";
    process.env.LLM_ORDEM_FALLBACK = " Gemini , Groq ";
    process.env.LLM_FALLBACK_GEMINI = "true";
    expect(obter_ordem_fallback_do_ambiente()).toEqual(["groq", "gemini"]);
  });
});

describe("ollama_habilitado", () => {
  it("fica desligado por padrão e só liga com flag explícita", () => {
    expect(ollama_habilitado({})).toBe(false);
    expect(ollama_habilitado({ OLLAMA_HABILITADO: "false" })).toBe(false);
    expect(ollama_habilitado({ OLLAMA_HABILITADO: "true" })).toBe(true);
    expect(ollama_habilitado({ OLLAMA_HABILITADO: "1" })).toBe(true);
  });
});
