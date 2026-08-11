import Fastify from "fastify";
import cors from "@fastify/cors";
import { resumir_config_provedores_ia } from "@lancai/ia";
import { registrar_rotas_usuario } from "./rotas/usuarios";
import { registrar_rotas_conta } from "./rotas/contas";
import { registrar_rotas_cartao } from "./rotas/cartoes";
import { registrar_rotas_categoria } from "./rotas/categorias";
import { registrar_rotas_regras } from "./rotas/regras";
import { registrar_rotas_pessoa } from "./rotas/pessoas";
import { registrar_rotas_movimento } from "./rotas/movimentos";
import { registrar_rotas_conhecimento } from "./rotas/conhecimento";
import { registrar_rotas_dashboard } from "./rotas/dashboard";
import { registrar_rotas_chat } from "./rotas/chat";
import { registrar_rotas_webhooks_evolution } from "./rotas/webhooks-evolution";
import { registrar_rotas_webhooks_open_finance } from "./rotas/webhooks-open-finance";
import { registrar_rotas_open_finance } from "./rotas/open-finance";
import { registrar_rotas_cron } from "./rotas/cron";
import { registrar_rotas_workspaces } from "./rotas/workspaces";
import { tratar_erro } from "./tratar-erro";

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
async function origem_cors_permitida(origem: string | undefined): Promise<boolean> {
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

export function criar_servidor() {
  const app = Fastify({ logger: true });

  app.register(cors, { origin: origem_cors_permitida });

  app.get("/saude", async () => ({ status: "ok", servico: "lancai-api" }));
  app.get("/health", async () => {
    const llm = resumir_config_provedores_ia();
    return {
      status: "ok",
      servico: "lancai-api",
      llm: { ordem: llm.ordem, disponiveis: llm.disponiveis, chaves: llm.chaves },
    };
  });

  app.register(registrar_rotas_usuario, { prefix: "/usuarios" });
  app.register(registrar_rotas_workspaces, { prefix: "/workspaces" });
  app.register(registrar_rotas_conta, { prefix: "/contas" });
  app.register(registrar_rotas_cartao, { prefix: "/cartoes" });
  app.register(registrar_rotas_categoria, { prefix: "/categorias" });
  app.register(registrar_rotas_regras, { prefix: "/regras" });
  app.register(registrar_rotas_pessoa, { prefix: "/pessoas" });
  app.register(registrar_rotas_movimento, { prefix: "/movimentos" });
  app.register(registrar_rotas_conhecimento, { prefix: "/conhecimento" });
  app.register(registrar_rotas_dashboard, { prefix: "/dashboard" });
  app.register(registrar_rotas_chat, { prefix: "/chat" });
  app.register(registrar_rotas_webhooks_evolution, { prefix: "/api/webhooks" });
  app.register(registrar_rotas_webhooks_open_finance, { prefix: "/api/webhooks" });
  app.register(registrar_rotas_open_finance, { prefix: "/open-finance" });
  app.register(registrar_rotas_cron, { prefix: "/cron" });

  app.setErrorHandler(tratar_erro);

  return app;
}
