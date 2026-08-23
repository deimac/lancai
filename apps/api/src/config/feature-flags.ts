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
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;

export function isFlagEnabled(key: FeatureFlagKey): boolean {
  return FEATURE_FLAGS[key];
}
