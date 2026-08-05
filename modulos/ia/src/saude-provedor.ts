import type { ProvedorIA } from "./provedores-ia";

interface EntradaCacheSaude {
  saudavel: boolean;
  verificadoEm: number;
  /** `falha` = geração real falhou; `ping` = health-check proativo. */
  origem: "falha" | "ping" | "sucesso";
}

interface MetricasProvedor {
  atendimentos: number;
  falhas: number;
  puladosPorSaude: number;
}

const cacheSaude = new Map<ProvedorIA, EntradaCacheSaude>();
const metricas = new Map<ProvedorIA, MetricasProvedor>();

/** Injetável nos testes — evita rede. Só este caminho pode forçar skip. */
type VerificadorSaude = (provedor: ProvedorIA) => Promise<boolean>;
let verificadorParaTestes: VerificadorSaude | null = null;

function ttl_saude_ms(): number {
  const bruto = Number(process.env.LLM_HEALTH_TTL_MS ?? "45000");
  return Number.isFinite(bruto) && bruto >= 5000 ? bruto : 45000;
}

function timeout_ping_ms(): number {
  const bruto = Number(process.env.LLM_HEALTH_PING_MS ?? "2500");
  return Number.isFinite(bruto) && bruto >= 500 ? bruto : 2500;
}

function metricas_de(provedor: ProvedorIA): MetricasProvedor {
  const atual = metricas.get(provedor) ?? { atendimentos: 0, falhas: 0, puladosPorSaude: 0 };
  metricas.set(provedor, atual);
  return atual;
}

export function resetar_cache_saude_provedores(): void {
  cacheSaude.clear();
}

export function resetar_metricas_provedores(): void {
  metricas.clear();
}

export function definir_verificador_saude_para_testes(fn: VerificadorSaude | null): void {
  verificadorParaTestes = fn;
}

export function obter_metricas_provedores(): Record<string, MetricasProvedor> {
  return Object.fromEntries([...metricas.entries()]);
}

export function registrar_atendimento_provedor(provedor: ProvedorIA): void {
  metricas_de(provedor).atendimentos += 1;
  cacheSaude.set(provedor, { saudavel: true, verificadoEm: Date.now(), origem: "sucesso" });
}

export function registrar_falha_saude_provedor(provedor: ProvedorIA): void {
  metricas_de(provedor).falhas += 1;
  cacheSaude.set(provedor, { saudavel: false, verificadoEm: Date.now(), origem: "falha" });
}

export function registrar_pulado_por_saude(provedor: ProvedorIA): void {
  metricas_de(provedor).puladosPorSaude += 1;
}

/**
 * Health-check leve com cache TTL.
 *
 * Em produção é fail-open: ping/falha recente NÃO bloqueiam a tentativa real
 * (o circuit breaker cuida de instabilidade). Bloquear aqui causava 503 em
 * cascata depois de um timeout.
 *
 * Só o verificador de testes pode forçar "frio".
 */
export async function provedor_esta_saudavel(provedor: ProvedorIA): Promise<boolean> {
  if (verificadorParaTestes) {
    const agora = Date.now();
    const cached = cacheSaude.get(provedor);
    if (cached && agora - cached.verificadoEm < ttl_saude_ms()) {
      return cached.saudavel;
    }
    const saudavel = await verificadorParaTestes(provedor);
    cacheSaude.set(provedor, {
      saudavel,
      verificadoEm: agora,
      origem: saudavel ? "ping" : "falha",
    });
    return saudavel;
  }

  const agora = Date.now();
  const cached = cacheSaude.get(provedor);
  if (cached?.saudavel && agora - cached.verificadoEm < ttl_saude_ms()) {
    return true;
  }

  const pingOk = await ping_provedor(provedor);
  cacheSaude.set(provedor, {
    saudavel: pingOk,
    verificadoEm: agora,
    origem: pingOk ? "sucesso" : "ping",
  });
  // Fail-open: mesmo com ping ruim, tenta a chamada (timeout/circuit decidem).
  return true;
}

async function ping_provedor(provedor: ProvedorIA): Promise<boolean> {
  const signal = AbortSignal.timeout(timeout_ping_ms());

  try {
    switch (provedor) {
      case "ollama": {
        const base = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
        const resposta = await fetch(`${base}/api/tags`, { signal });
        return resposta.ok;
      }
      case "groq": {
        const chave = process.env.GROQ_API_KEY;
        if (!chave) return false;
        const resposta = await fetch("https://api.groq.com/openai/v1/models", {
          headers: { Authorization: `Bearer ${chave}` },
          signal,
        });
        return resposta.ok;
      }
      case "gemini": {
        const chave = process.env.GEMINI_API_KEY;
        if (!chave) return false;
        const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
        url.searchParams.set("key", chave);
        url.searchParams.set("pageSize", "1");
        const resposta = await fetch(url, { signal });
        return resposta.ok;
      }
      case "openrouter": {
        const chave = process.env.OPENROUTER_API_KEY;
        if (!chave) return false;
        const resposta = await fetch("https://openrouter.ai/api/v1/models", {
          headers: { Authorization: `Bearer ${chave}` },
          signal,
        });
        return resposta.ok;
      }
      case "openai": {
        const chave = process.env.OPENAI_API_KEY;
        if (!chave) return false;
        const resposta = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${chave}` },
          signal,
        });
        return resposta.ok;
      }
    }
  } catch {
    return false;
  }
}
