import Fastify from "fastify";
import cors from "@fastify/cors";
import { registrar_rotas_usuario } from "./rotas/usuarios";
import { registrar_rotas_conta } from "./rotas/contas";
import { registrar_rotas_cartao } from "./rotas/cartoes";
import { registrar_rotas_categoria } from "./rotas/categorias";
import { registrar_rotas_pessoa } from "./rotas/pessoas";
import { registrar_rotas_movimento } from "./rotas/movimentos";
import { registrar_rotas_chat } from "./rotas/chat";
import { registrar_rotas_webhooks_evolution } from "./rotas/webhooks-evolution";
import { tratar_erro } from "./tratar-erro";

export function criar_servidor() {
  const app = Fastify({ logger: true });

  app.register(cors, { origin: process.env.URL_WEB ?? "http://localhost:5173" });

  app.get("/saude", async () => ({ status: "ok", servico: "lancai-api" }));

  app.register(registrar_rotas_usuario, { prefix: "/usuarios" });
  app.register(registrar_rotas_conta, { prefix: "/contas" });
  app.register(registrar_rotas_cartao, { prefix: "/cartoes" });
  app.register(registrar_rotas_categoria, { prefix: "/categorias" });
  app.register(registrar_rotas_pessoa, { prefix: "/pessoas" });
  app.register(registrar_rotas_movimento, { prefix: "/movimentos" });
  app.register(registrar_rotas_chat, { prefix: "/chat" });
  app.register(registrar_rotas_webhooks_evolution, { prefix: "/api/webhooks" });

  app.setErrorHandler(tratar_erro);

  return app;
}
