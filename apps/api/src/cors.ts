function eh_ip_privado(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(hostname);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/**
 * Libera o front local (localhost / 127.0.0.1 / IP da LAN/VPN nas portas do Vite).
 * Em produção só URL_WEB + CORS_ORIGENS.
 * Assinatura alinhada a `@fastify/cors` (`AsyncOriginFunction`).
 */
export async function origem_cors_permitida(origem: string | undefined): Promise<boolean> {
  // Pedidos sem Origin (curl, healthcheck, mesmo host) não precisam de CORS.
  if (!origem) return true;

  const urlWeb = process.env.URL_WEB ?? "http://localhost:5173";
  const extras = (process.env.CORS_ORIGENS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const listaFixa = new Set([urlWeb, ...extras]);
  if (listaFixa.has(origem)) return true;

  if (process.env.NODE_ENV === "production") return false;

  try {
    const url = new URL(origem);
    const porta = url.port === "" ? (url.protocol === "https:" ? "443" : "80") : url.port;
    const portaNum = Number(porta);
    // Vite usa 5173; se ocupada, sobe 5174+. Preview usa 4173.
    const portaOk = portaNum === 4173 || (portaNum >= 5173 && portaNum <= 5199);
    const hostOk = eh_ip_privado(url.hostname);
    return url.protocol === "http:" && portaOk && hostOk;
  } catch {
    return false;
  }
}

/**
 * `reply.hijack()` + `writeHead` pulam o `@fastify/cors`. Sem ACAO o browser
 * esconde o NDJSON e o front mostra “não consegui falar com a API”.
 */
export async function cabecalhos_stream_ndjson(
  origem: string | undefined,
): Promise<Record<string, string>> {
  const cabecalhos: Record<string, string> = {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
  };
  if (origem && (await origem_cors_permitida(origem))) {
    cabecalhos["Access-Control-Allow-Origin"] = origem;
    cabecalhos.Vary = "Origin";
  }
  return cabecalhos;
}
