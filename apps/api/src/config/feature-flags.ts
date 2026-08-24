/**
 * Feature flags do Assistente 2.0. Todas desligadas por padrão — o legado continua.
 */
export const FEATURE_FLAGS = {
  ASSISTENTE_V2_SESSION: process.env.ASSISTENTE_V2_SESSION === "true",
  ASSISTENTE_V2_PARSER: process.env.ASSISTENTE_V2_PARSER === "true",
  ASSISTENTE_V2_RESOLVER: process.env.ASSISTENTE_V2_RESOLVER === "true",
  ASSISTENTE_V2_POLICY: process.env.ASSISTENTE_V2_POLICY === "true",
  ASSISTENTE_V2_EXECUTE: process.env.ASSISTENTE_V2_EXECUTE === "true",
  ASSISTENTE_V2_CORE: process.env.ASSISTENTE_V2_CORE === "true",
  ASSISTENTE_V2_ASSISTANT: process.env.ASSISTENTE_V2_ASSISTANT === "true",
  ASSISTENTE_V2_SHADOW: process.env.ASSISTENTE_V2_SHADOW === "true",
  ASSISTENTE_V3_SESSION: process.env.ASSISTENTE_V3_SESSION === "true",
  ASSISTENTE_V3_PARSER: process.env.ASSISTENTE_V3_PARSER === "true",
  ASSISTENTE_V3_RESOLVER: process.env.ASSISTENTE_V3_RESOLVER === "true",
  ASSISTENTE_V3_POLICY: process.env.ASSISTENTE_V3_POLICY === "true",
  ASSISTENTE_V3_EXECUTE: process.env.ASSISTENTE_V3_EXECUTE === "true",
  ASSISTENTE_V3_CORE: process.env.ASSISTENTE_V3_CORE === "true",
  ASSISTENTE_V3_ASSISTANT: process.env.ASSISTENTE_V3_ASSISTANT === "true",
  ASSISTENTE_V3_SHADOW: process.env.ASSISTENTE_V3_SHADOW === "true",
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;

export function isFlagEnabled(key: FeatureFlagKey): boolean {
  return process.env[key] === "true";
}

export type PipelineAssistente = "v3" | "v2" | "legado";

export function pipelineAssistenteAtivo(): PipelineAssistente {
  if (isFlagEnabled("ASSISTENTE_V3_ASSISTANT")) return "v3";
  if (isFlagEnabled("ASSISTENTE_V2_ASSISTANT")) return "v2";
  return "legado";
}
