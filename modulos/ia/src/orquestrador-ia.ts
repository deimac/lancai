import { generateObject, generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import type { z } from "zod";
import { ErroTodosProvedoresFalharam } from "./erros";
import { montar_prompt_sistema_ollama } from "./prompt-ollama";
import { PROVEDORES_IA, type ProvedorIA } from "./provedores-ia";
import {
  provedor_esta_saudavel,
  registrar_atendimento_provedor,
  registrar_falha_saude_provedor,
  registrar_pulado_por_saude,
  resetar_cache_saude_provedores,
} from "./saude-provedor";

export { PROVEDORES_IA, type ProvedorIA } from "./provedores-ia";
export {
  definir_verificador_saude_para_testes,
  obter_metricas_provedores,
  resetar_cache_saude_provedores,
  resetar_metricas_provedores,
} from "./saude-provedor";

/** Extrai o primeiro objeto JSON de uma resposta textual do Ollama. */
function extrair_json_objeto(texto: string): unknown {
  const limpo = texto
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(limpo);
  } catch {
    const inicio = limpo.indexOf("{");
    const fim = limpo.lastIndexOf("}");
    if (inicio >= 0 && fim > inicio) {
      return JSON.parse(limpo.slice(inicio, fim + 1));
    }
    throw new Error("Ollama não devolveu JSON válido");
  }
}

/**
 * Ordem padrão de produção: Groq (rápido) → Gemini estável.
 * Ollama é opcional (local/dev) e só entra com `OLLAMA_HABILITADO=true`.
 * OpenRouter/OpenAI ficam depois se configurados.
 */

/** Ollama fica isolado até ser ligado explicitamente (ex.: Mac local). Na VPS fica off. */
export function ollama_habilitado(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const bruto = (env.OLLAMA_HABILITADO ?? "").trim().toLowerCase();
  return bruto === "true" || bruto === "1" || bruto === "yes" || bruto === "on";
}

/** Modelos padrão por provedor, sobrepostos por `<PROVEDOR>_MODEL` no ambiente. */
const MODELOS_PADRAO: Record<ProvedorIA, string> = {
  // Precisa ser um modelo com suporte a saída estruturada (`response_format: json_schema`) na
  // Groq — hoje só openai/gpt-oss-20b e openai/gpt-oss-120b; llama-3.3-70b-versatile devolve 400.
  groq: "openai/gpt-oss-120b",
  // Evitar variantes "thinking"/3.x lentas no chat conversacional.
  gemini: "gemini-2.0-flash",
  // Enxuto para Mac/VPS 8GB (Hostinger KVM2) — último fallback, não caminho padrão.
  ollama: "qwen2.5:3b-instruct",
  openrouter: "openai/gpt-4o-mini",
  openai: "gpt-4o-mini",
};

const FALHAS_PARA_ABRIR_CIRCUITO = 3;
const COOLDOWN_CIRCUITO_MS = 2 * 60 * 1000;

interface EstadoCircuito {
  falhasSeguidas: number;
  abertoAte: number;
}

/** Circuit breaker em memória do processo — pula provedor instável por alguns minutos. */
const circuitos = new Map<ProvedorIA, EstadoCircuito>();

export function resetar_circuitos_provedores(): void {
  circuitos.clear();
  resetar_cache_saude_provedores();
}

function circuito_esta_aberto(provedor: ProvedorIA): boolean {
  const estado = circuitos.get(provedor);
  if (!estado) return false;
  if (Date.now() < estado.abertoAte) return true;
  if (estado.abertoAte > 0) {
    // Cooldown expirou — permite nova tentativa.
    circuitos.set(provedor, { falhasSeguidas: 0, abertoAte: 0 });
  }
  return false;
}

function registrar_sucesso_circuito(provedor: ProvedorIA): void {
  circuitos.set(provedor, { falhasSeguidas: 0, abertoAte: 0 });
}

function registrar_falha_circuito(provedor: ProvedorIA): void {
  const atual = circuitos.get(provedor) ?? { falhasSeguidas: 0, abertoAte: 0 };
  const falhasSeguidas = atual.falhasSeguidas + 1;
  const abertoAte =
    falhasSeguidas >= FALHAS_PARA_ABRIR_CIRCUITO ? Date.now() + COOLDOWN_CIRCUITO_MS : 0;
  circuitos.set(provedor, { falhasSeguidas, abertoAte });
}

export function obter_ordem_fallback_do_ambiente(): ProvedorIA[] {
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
      return ollama_habilitado() && Boolean(process.env.OLLAMA_BASE_URL);
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
      return createOpenAI({
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: "https://openrouter.ai/api/v1",
      })(modeloId);
    case "ollama":
      return createOpenAI({
        apiKey: "ollama",
        baseURL: `${process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434"}/v1`,
      })(modeloId);
  }
}

export interface EntradaGerarObjetoEstruturado<T> {
  // Input relaxado para `any`: alguns campos do schema usam `z.preprocess` (ex.: recuperação
  // de números degenerados em CRIAR_CARTAO), o que faz o tipo de entrada do Zod divergir do
  // tipo de saída — pinar o Input em T quebraria a inferência para esses casos.
  schema: z.ZodType<T, z.ZodTypeDef, any>;
  prompt: string;
  system?: string;
}

/** Tentativas no mesmo provedor (glitches de geração / JSON inválido). */
const TENTATIVAS_POR_PROVEDOR = 2;

/** Timeout cloud; Ollama usa `LLM_TIMEOUT_OLLAMA_MS` (mais folga em CPU). */
function timeout_por_tentativa_ms(provedor: ProvedorIA): number {
  if (provedor === "ollama") {
    const bruto = Number(process.env.LLM_TIMEOUT_OLLAMA_MS ?? "90000");
    return Number.isFinite(bruto) && bruto >= 5000 ? bruto : 90000;
  }
  const bruto = Number(process.env.LLM_TIMEOUT_MS ?? "10000");
  return Number.isFinite(bruto) && bruto >= 2000 ? bruto : 10000;
}

/**
 * Erros em que vale retry no mesmo provedor (JSON/schema) antes do fallback.
 * Timeout/abort e 5xx vão direto para o próximo.
 */
function eh_erro_transitorio_de_geracao(erro: unknown): boolean {
  if (!(erro instanceof Error)) return false;
  if (erro.name === "TimeoutError" || erro.name === "AbortError") return false;
  return erro.name === "AI_NoObjectGeneratedError" || erro.name === "AI_TypeValidationError";
}

/**
 * Escolhe qual provedor de IA usar e faz fallback automático.
 * Só gera objetos estruturados — a IA nunca tem acesso de escrita ao banco (ADR-003).
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
      if (circuito_esta_aberto(provedor)) {
        detalhesFalha.push({
          provedor,
          erro: new Error(`Circuito aberto — pulando ${provedor} temporariamente`),
        });
        continue;
      }

      const saudavel = await provedor_esta_saudavel(provedor);
      if (!saudavel) {
        registrar_pulado_por_saude(provedor);
        detalhesFalha.push({
          provedor,
          erro: new Error(`Health-check falhou — pulando ${provedor}`),
        });
        continue;
      }

      const modelo = obter_modelo(provedor);
      let ultimoErro: unknown;

      for (let tentativa = 1; tentativa <= TENTATIVAS_POR_PROVEDOR; tentativa++) {
        try {
          const abortSignal = AbortSignal.timeout(timeout_por_tentativa_ms(provedor));

          // Ollama 3B em CPU: JSON Schema enorme (anyOf) derruba o runner.
          // Usa texto → JSON → Zod, com prompt curto.
          if (provedor === "ollama") {
            const gerado = await generateText({
              model: modelo,
              system: entrada.system ? montar_prompt_sistema_ollama() : undefined,
              prompt: `${entrada.prompt}

Responda com UM único objeto JSON válido. Sem markdown, sem texto fora do JSON.`,
              abortSignal,
            });
            const bruto = extrair_json_objeto(gerado.text);
            const objeto = entrada.schema.parse(bruto);
            registrar_sucesso_circuito(provedor);
            registrar_atendimento_provedor(provedor);
            return objeto;
          }

          const resultado = await generateObject({
            model: modelo,
            schema: entrada.schema,
            prompt: entrada.prompt,
            system: entrada.system,
            abortSignal,
            // Groq: schema estrito exige todos os campos em required; usamos best-effort.
            providerOptions: { groq: { strictJsonSchema: false } },
          });
          registrar_sucesso_circuito(provedor);
          registrar_atendimento_provedor(provedor);
          return resultado.object;
        } catch (erro) {
          ultimoErro = erro;
          if (tentativa < TENTATIVAS_POR_PROVEDOR && eh_erro_transitorio_de_geracao(erro)) {
            continue;
          }
          break;
        }
      }

      registrar_falha_circuito(provedor);
      registrar_falha_saude_provedor(provedor);
      detalhesFalha.push({ provedor, erro: ultimoErro });
    }

    throw new ErroTodosProvedoresFalharam(detalhesFalha);
  }
}
