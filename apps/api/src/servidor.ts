import Fastify from "fastify";
import cors from "@fastify/cors";
import { resumir_config_provedores_ia } from "@lancai/ia";
import { origem_cors_permitida } from "./cors";
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
import { registrar_rotas_recorrencia } from "./rotas/recorrencias";
import { registrar_rotas_importacao } from "./rotas/importacoes";
import { tratar_erro } from "./tratar-erro";

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
  app.register(registrar_rotas_recorrencia, { prefix: "/recorrencias" });
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
  app.register(registrar_rotas_importacao, { prefix: "/importacoes" });

  app.setErrorHandler(tratar_erro);

  return app;
}
