import { afterEach, describe, expect, it } from "vitest";
import {
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

  it("usa ordem padrão com groq → gemini → ollama primeiro", () => {
    delete process.env.LLM_ORDEM_FALLBACK;
    delete process.env.LLM_PROVEDOR_PADRAO;
    expect(PROVEDORES_IA.slice(0, 3)).toEqual(["groq", "gemini", "ollama"]);
    expect(obter_ordem_fallback_do_ambiente()[0]).toBe("groq");
  });

  it("força groq como primeiro mesmo com LLM_PROVEDOR_PADRAO=gemini", () => {
    process.env.LLM_ORDEM_FALLBACK = "groq,gemini,ollama";
    process.env.LLM_PROVEDOR_PADRAO = "gemini";
    expect(obter_ordem_fallback_do_ambiente()).toEqual(["groq", "gemini", "ollama"]);
  });

  it("normaliza maiúsculas e espaços e mantém groq na frente", () => {
    process.env.LLM_ORDEM_FALLBACK = " Gemini , Groq ";
    process.env.LLM_PROVEDOR_PADRAO = "gemini";
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
