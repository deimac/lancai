export type ConfiguracaoEvolution = {
  url: string;
  apiKey: string;
  instance: string;
};

/** Lê e valida as variáveis EVOLUTION_* do ambiente. */
export function carregarConfiguracaoEvolution(
  env: Record<string, string | undefined> = process.env,
): ConfiguracaoEvolution {
  const url = (env.EVOLUTION_URL ?? "").trim().replace(/\/+$/, "");
  const apiKey = (env.EVOLUTION_GLOBAL_API_KEY ?? "").trim();
  const instance = (env.EVOLUTION_INSTANCE ?? "").trim();

  if (!url) {
    throw new Error("Variável de ambiente obrigatória ausente: EVOLUTION_URL.");
  }
  if (!apiKey) {
    throw new Error("Variável de ambiente obrigatória ausente: EVOLUTION_GLOBAL_API_KEY.");
  }
  if (!instance) {
    throw new Error("Variável de ambiente obrigatória ausente: EVOLUTION_INSTANCE.");
  }

  return { url, apiKey, instance };
}
