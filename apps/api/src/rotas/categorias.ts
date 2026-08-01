import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { categoria, obter_banco } from "@lancai/banco";
import { schemaCriarCategoria } from "@lancai/tipos";

export async function registrar_rotas_categoria(app: FastifyInstance) {
  app.post("/", async (requisicao, resposta) => {
    const dados = schemaCriarCategoria.parse(requisicao.body);
    const banco = obter_banco();
    const [criada] = await banco.insert(categoria).values(dados).returning();
    return resposta.status(201).send(criada);
  });

  app.get("/", async (requisicao) => {
    const { usuarioId } = requisicao.query as { usuarioId?: string };
    const banco = obter_banco();
    if (usuarioId) {
      return banco.select().from(categoria).where(eq(categoria.usuarioId, usuarioId));
    }
    return banco.select().from(categoria);
  });
}
