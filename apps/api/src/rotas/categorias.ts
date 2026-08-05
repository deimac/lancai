import type { FastifyInstance } from "fastify";
import { categoria, obter_banco } from "@lancai/banco";
import { garantir_categorias_padrao, RepositorioContextoDrizzle } from "@lancai/ia";
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
      return garantir_categorias_padrao(usuarioId, new RepositorioContextoDrizzle());
    }
    return banco.select().from(categoria);
  });
}
