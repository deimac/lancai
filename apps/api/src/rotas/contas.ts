import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { conta, garantir_workspace_do_usuario, obter_banco } from "@lancai/banco";
import {
  schemaCriarConta,
  schemaExcluirContaApi,
  schemaPatchContaApi,
} from "@lancai/tipos";

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
    if (!usuarioId) {
      return banco.select().from(conta).where(eq(conta.ativo, true));
    }
    const workspaceId = await garantir_workspace_do_usuario(banco, usuarioId);
    return banco
      .select()
      .from(conta)
      .where(
        and(eq(conta.usuarioId, usuarioId), eq(conta.workspaceId, workspaceId), eq(conta.ativo, true)),
      );
  });

  app.get("/:id", async (requisicao, resposta) => {
    const { id } = requisicao.params as { id: string };
    const banco = obter_banco();
    const [encontrada] = await banco.select().from(conta).where(eq(conta.id, id)).limit(1);
    if (!encontrada || !encontrada.ativo) {
      return resposta.status(404).send({ erro: "Conta não encontrada." });
    }
    return encontrada;
  });

  app.patch("/:id", async (requisicao, resposta) => {
    const { id } = requisicao.params as { id: string };
    const dados = schemaPatchContaApi.parse(requisicao.body);
    const banco = obter_banco();
    const workspaceId = await garantir_workspace_do_usuario(banco, dados.usuarioId);

    const [existente] = await banco
      .select()
      .from(conta)
      .where(
        and(
          eq(conta.id, id),
          eq(conta.usuarioId, dados.usuarioId),
          eq(conta.workspaceId, workspaceId),
          eq(conta.ativo, true),
        ),
      )
      .limit(1);

    if (!existente) {
      return resposta.status(404).send({ erro: "Conta não encontrada." });
    }

    if (dados.saldoAtual != null && existente.sincronizada) {
      return resposta.status(400).send({
        erro: "Conta sincronizada: o saldo vem do banco e não pode ser alterado manualmente.",
      });
    }

    const valores: Partial<typeof conta.$inferInsert> = { dataAtualizacao: new Date() };
    if (dados.nome != null) valores.nome = dados.nome;
    if (dados.perfil != null) valores.perfil = dados.perfil;
    if (dados.saldoAtual != null) valores.saldoAtual = String(dados.saldoAtual);

    if (Object.keys(valores).length === 1) {
      return resposta.status(400).send({ erro: "Nenhum campo para atualizar." });
    }

    const [atualizada] = await banco
      .update(conta)
      .set(valores)
      .where(eq(conta.id, id))
      .returning();

    return atualizada;
  });

  app.delete("/:id", async (requisicao, resposta) => {
    const { id } = requisicao.params as { id: string };
    const dados = schemaExcluirContaApi.parse(requisicao.body);
    const banco = obter_banco();
    const workspaceId = await garantir_workspace_do_usuario(banco, dados.usuarioId);

    const [existente] = await banco
      .select()
      .from(conta)
      .where(
        and(
          eq(conta.id, id),
          eq(conta.usuarioId, dados.usuarioId),
          eq(conta.workspaceId, workspaceId),
          eq(conta.ativo, true),
        ),
      )
      .limit(1);

    if (!existente) {
      return resposta.status(404).send({ erro: "Conta não encontrada." });
    }

    const [removida] = await banco
      .update(conta)
      .set({ ativo: false, dataAtualizacao: new Date() })
      .where(eq(conta.id, id))
      .returning();

    return removida;
  });
}
