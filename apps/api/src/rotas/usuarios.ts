import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { obter_banco, usuario } from "@lancai/banco";
import { schemaCriarUsuario } from "@lancai/tipos";

export async function registrar_rotas_usuario(app: FastifyInstance) {
  app.post("/", async (requisicao, resposta) => {
    const dados = schemaCriarUsuario.parse(requisicao.body);
    const banco = obter_banco();
    const [criado] = await banco.insert(usuario).values(dados).returning();
    return resposta.status(201).send(criado);
  });

  app.get("/:id", async (requisicao, resposta) => {
    const { id } = requisicao.params as { id: string };
    const banco = obter_banco();
    const [encontrado] = await banco.select().from(usuario).where(eq(usuario.id, id)).limit(1);
    if (!encontrado) {
      return resposta.status(404).send({ erro: "Usuário não encontrado." });
    }
    return encontrado;
  });
}
