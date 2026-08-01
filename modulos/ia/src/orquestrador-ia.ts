import { generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import type { z } from "zod";
import { ErroTodosProvedoresFalharam } from "./erros";

export const PROVEDORES_IA = ["gemini", "groq", "openrouter", "ollama", "openai"] as const;
export type ProvedorIA = (typeof PROVEDORES_IA)[number];

/** Modelos padrão por provedor, sobrepostos por `<PROVEDOR>_MODEL` no ambiente. */
const MODELOS_PADRAO: Record<ProvedorIA, string> = {
  gemini: "gemini-2.0-flash",
  groq: "llama-3.3-70b-versatile",
  openrouter: "openai/gpt-4o-mini",
  ollama: "llama3.1",
  openai: "gpt-4o-mini",
};

function obter_ordem_fallback_do_ambiente(): ProvedorIA[] {
  const bruto = process.env.LLM_ORDEM_FALLBACK;
  const provedorPadrao = process.env.LLM_PROVEDOR_PADRAO as ProvedorIA | undefined;

  const ordem = bruto
    ? bruto
        .split(",")
        .map((item) => item.trim())
        .filter((item): item is ProvedorIA => (PROVEDORES_IA as readonly string[]).includes(item))
    : [...PROVEDORES_IA];

  if (provedorPadrao && ordem.includes(provedorPadrao)) {
    return [provedorPadrao, ...ordem.filter((provedor) => provedor !== provedorPadrao)];
  }
  return ordem;
}

function provedor_disponivel(provedor: ProvedorIA): boolean {
  switch (provedor) {
    case "gemini":
      return Boolean(process.env.GEMINI_API_KEY);
    case "groq":
      return Boolean(process.env.GROQ_API_KEY);
    case "openrouter":
      return Boolean(process.env.OPENROUTER_API_KEY);
    case "openai":
      return Boolean(process.env.OPENAI_API_KEY);
    case "ollama":
      return Boolean(process.env.OLLAMA_BASE_URL);
  }
}

function obter_modelo(provedor: ProvedorIA) {
  const modeloId = process.env[`${provedor.toUpperCase()}_MODEL`] ?? MODELOS_PADRAO[provedor];

  switch (provedor) {
    case "gemini":
      return createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY })(modeloId);
    case "groq":
      return createGroq({ apiKey: process.env.GROQ_API_KEY })(modeloId);
    case "openai":
      return createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(modeloId);
    case "openrouter":
      // OpenRouter expõe uma API compatível com a OpenAI.
      return createOpenAI({
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: "https://openrouter.ai/api/v1",
      })(modeloId);
    case "ollama":
      // Ollama expõe uma API compatível com a OpenAI em /v1; a chave é ignorada.
      return createOpenAI({
        apiKey: "ollama",
        baseURL: `${process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"}/v1`,
      })(modeloId);
  }
}

export interface EntradaGerarObjetoEstruturado<T> {
  schema: z.ZodType<T>;
  prompt: string;
  system?: string;
}

/**
 * Escolhe qual provedor de IA usar (Gemini, Groq, OpenRouter, Ollama, OpenAI)
 * e faz fallback automático para o próximo da lista em caso de erro, limite de
 * uso ou provedor não configurado. Só é usado para gerar objetos estruturados
 * (nunca texto livre) — a IA nunca tem acesso de escrita ao banco (ADR-003).
 */
export class OrquestradorIA {
  private readonly ordemFallback: ProvedorIA[];

  constructor(ordemFallback?: ProvedorIA[]) {
    this.ordemFallback = ordemFallback ?? obter_ordem_fallback_do_ambiente();
  }

  async gerar_objeto_estruturado<T>(entrada: EntradaGerarObjetoEstruturado<T>): Promise<T> {
    const provedoresDisponiveis = this.ordemFallback.filter(provedor_disponivel);
    const detalhesFalha: Array<{ provedor: string; erro: unknown }> = [];

    if (provedoresDisponiveis.length === 0) {
      throw new ErroTodosProvedoresFalharam(detalhesFalha);
    }

    for (const provedor of provedoresDisponiveis) {
      try {
        const modelo = obter_modelo(provedor);
        const resultado = await generateObject({
          model: modelo,
          schema: entrada.schema,
          prompt: entrada.prompt,
          system: entrada.system,
        });
        return resultado.object;
      } catch (erro) {
        detalhesFalha.push({ provedor, erro });
      }
    }

    throw new ErroTodosProvedoresFalharam(detalhesFalha);
  }
}
