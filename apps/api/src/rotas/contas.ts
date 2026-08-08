import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { conta, garantir_workspace_do_usuario, obter_banco } from "@lancai/banco";
import { schemaCriarConta } from "@lancai/tipos";

export async function registrar_rotas_conta(app: FastifyInstance) {
  app.post("/", async (requisicao, resposta) => {
    const dados = schemaCriarConta.parse(requisicao.body);
    const banco = obter_banco();
    const workspaceId = await garantir_workspace_do_usuario(banco, dados.usuarioId);
    const [criada] = await banco
      .insert(conta)
      .values({
        nome: dados.nome,
        perfil: dados.perfil,
        usuarioId: dados.usuarioId,
        workspaceId,
        saldoInicial: String(dados.saldoInicial),
        saldoAtual: String(dados.saldoInicial),
      })
      .returning();
    return resposta.status(201).send(criada);
  });

  app.get("/", async (requisicao) => {
    const { usuarioId } = requisicao.query as { usuarioId?: string };
    const banco = obter_banco();
    if (usuarioId) {
      return banco
        .select()
        .from(conta)
        .where(and(eq(conta.usuarioId, usuarioId), eq(conta.ativo, true)));
    }
    return banco.select().from(conta).where(eq(conta.ativo, true));
  });

  app.get("/:id", async (requisicao, resposta) => {
    const { id } = requisicao.params as { id: string };
    const banco = obter_banco();
    const [encontrada] = await banco.select().from(conta).where(eq(conta.id, id)).limit(1);
    if (!encontrada) {
      return resposta.status(404).send({ erro: "Conta não encontrada." });
    }
    return encontrada;
  });
}
