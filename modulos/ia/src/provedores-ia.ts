/** Provedores suportados pelo OrquestradorIA. */
export const PROVEDORES_IA = ["groq", "gemini", "ollama", "openrouter", "openai"] as const;
export type ProvedorIA = (typeof PROVEDORES_IA)[number];
