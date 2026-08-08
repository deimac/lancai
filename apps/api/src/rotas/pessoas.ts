import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { garantir_workspace_do_usuario, obter_banco, pessoa } from "@lancai/banco";
import { schemaCriarPessoa } from "@lancai/tipos";

export async function registrar_rotas_pessoa(app: FastifyInstance) {
  app.post("/", async (requisicao, resposta) => {
    const dados = schemaCriarPessoa.parse(requisicao.body);
    const banco = obter_banco();
    const workspaceId = await garantir_workspace_do_usuario(banco, dados.usuarioId);
    const [criada] = await banco
      .insert(pessoa)
      .values({ ...dados, workspaceId })
      .returning();
    return resposta.status(201).send(criada);
  });

  app.get("/", async (requisicao) => {
    const { usuarioId } = requisicao.query as { usuarioId?: string };
    const banco = obter_banco();
    if (usuarioId) {
      const workspaceId = await garantir_workspace_do_usuario(banco, usuarioId);
      return banco
        .select()
        .from(pessoa)
        .where(and(eq(pessoa.usuarioId, usuarioId), eq(pessoa.workspaceId, workspaceId)));
    }
    return banco.select().from(pessoa);
  });
}
