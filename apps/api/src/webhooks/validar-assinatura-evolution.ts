import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";

function compararSeguro(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

function extrairApikeyCabecalho(requisicao: FastifyRequest): string | undefined {
  const apikey = requisicao.headers.apikey;
  if (typeof apikey === "string" && apikey.trim()) return apikey.trim();

  const authorization = requisicao.headers.authorization;
  if (typeof authorization === "string" && authorization.trim()) {
    const valor = authorization.trim();
    if (valor.toLowerCase().startsWith("bearer ")) {
      return valor.slice(7).trim();
    }
    return valor;
  }

  return undefined;
}

/**
 * Valida a "assinatura" do webhook Evolution:
 * - apikey no header (`apikey` ou `Authorization`) ou no body deve bater com EVOLUTION_GLOBAL_API_KEY
 * - instance do body (quando informada) deve bater com EVOLUTION_INSTANCE
 * - server_url do body (quando informado) deve corresponder a EVOLUTION_URL
 */
export function validarAssinaturaEvolution(
  requisicao: FastifyRequest,
  body: { apikey?: string; instance?: string; server_url?: string },
): { ok: true } | { ok: false; motivo: string } {
  const apiKeyGlobal = process.env.EVOLUTION_GLOBAL_API_KEY?.trim();
  const apiKeyInstancia = process.env.EVOLUTION_INSTANCE_API_KEY?.trim();
  if (!apiKeyGlobal && !apiKeyInstancia) {
    return { ok: false, motivo: "EVOLUTION_GLOBAL_API_KEY não configurada." };
  }

  const candidata = extrairApikeyCabecalho(requisicao) ?? body.apikey?.trim();
  if (!candidata) {
    return { ok: false, motivo: "Assinatura ausente (apikey)." };
  }

  const chaveValida =
    (apiKeyGlobal ? compararSeguro(candidata, apiKeyGlobal) : false) ||
    (apiKeyInstancia ? compararSeguro(candidata, apiKeyInstancia) : false);
  if (!chaveValida) {
    return { ok: false, motivo: "Assinatura inválida (apikey)." };
  }

  const instanciaEsperada = process.env.EVOLUTION_INSTANCE?.trim();
  if (
    instanciaEsperada &&
    body.instance &&
    body.instance.toLowerCase() !== instanciaEsperada.toLowerCase()
  ) {
    return { ok: false, motivo: "Instância não autorizada." };
  }

  const urlEsperada = process.env.EVOLUTION_URL?.trim().replace(/\/+$/, "");
  const serverUrl = body.server_url?.trim().replace(/\/+$/, "");
  if (urlEsperada && serverUrl && serverUrl !== urlEsperada) {
    return { ok: false, motivo: "server_url não autorizado." };
  }

  return { ok: true };
}
