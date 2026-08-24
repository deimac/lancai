import "./ambiente";
import { resumir_config_provedores_ia } from "@lancai/ia";
import { criar_servidor } from "./servidor";
import { isFlagEnabled } from "./config/feature-flags";

const app = criar_servidor();
const porta = Number(process.env.PORTA_API ?? 3333);
const llm = resumir_config_provedores_ia();
app.log.info(
  {
    ordem: llm.ordem,
    disponiveis: llm.disponiveis,
    chaves: llm.chaves,
  },
  "[ia] configuração de provedores no boot",
);
app.log.info(
  {
    v3Assistant: isFlagEnabled("ASSISTENTE_V3_ASSISTANT"),
    v3Shadow: isFlagEnabled("ASSISTENTE_V3_SHADOW"),
    v2Assistant: isFlagEnabled("ASSISTENTE_V2_ASSISTANT"),
  },
  "[assistente] flags no boot",
);
if (!llm.chaves.groq) {
  app.log.warn("[ia] GROQ_API_KEY ausente neste processo — o Coolify precisa expor a var em Runtime");
}

app
  .listen({ port: porta, host: "0.0.0.0" })
  .then(() => {
    app.log.info(`LançAI API rodando em http://localhost:${porta}`);
  })
  .catch((erro) => {
    app.log.error(erro);
    process.exit(1);
  });
