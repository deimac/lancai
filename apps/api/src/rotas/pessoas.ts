import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { obter_banco, pessoa } from "@lancai/banco";
import { schemaCriarPessoa } from "@lancai/tipos";

export async function registrar_rotas_pessoa(app: FastifyInstance) {
  app.post("/", async (requisicao, resposta) => {
    const dados = schemaCriarPessoa.parse(requisicao.body);
    const banco = obter_banco();
    const [criada] = await banco.insert(pessoa).values(dados).returning();
    return resposta.status(201).send(criada);
  });

  app.get("/", async (requisicao) => {
    const { usuarioId } = requisicao.query as { usuarioId?: string };
    const banco = obter_banco();
    if (usuarioId) {
      return banco.select().from(pessoa).where(eq(pessoa.usuarioId, usuarioId));
    }
    return banco.select().from(pessoa);
  });
}
