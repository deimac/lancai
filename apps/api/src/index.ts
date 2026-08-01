import "./ambiente";
import { criar_servidor } from "./servidor";

const app = criar_servidor();
const porta = Number(process.env.PORTA_API ?? 3333);

app
  .listen({ port: porta, host: "0.0.0.0" })
  .then(() => {
    app.log.info(`LançAI API rodando em http://localhost:${porta}`);
  })
  .catch((erro) => {
    app.log.error(erro);
    process.exit(1);
  });
