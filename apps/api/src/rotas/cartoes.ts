import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { cartao, garantir_workspace_do_usuario, obter_banco } from "@lancai/banco";
import {
  calcularMelhorDiaCompra,
  schemaCriarCartao,
  schemaExcluirCartaoApi,
  schemaPatchCartaoApi,
} from "@lancai/tipos";

/** Remove o payload cifrado das respostas públicas de listagem. */
function cartao_publico<T extends { dadosPlasticosCifrados?: string | null }>(linha: T) {
  const { dadosPlasticosCifrados: _omitido, ...publico } = linha;
  return publico;
}

export async function registrar_rotas_cartao(app: FastifyInstance) {
  app.post("/", async (requisicao, resposta) => {
    const dados = schemaCriarCartao.parse(requisicao.body);
    const banco = obter_banco();
    const workspaceId = await garantir_workspace_do_usuario(banco, dados.usuarioId);
    const [criado] = await banco
      .insert(cartao)
      .values({
        workspaceId,
        nome: dados.nome,
        limite: String(dados.limite),
        fechamento: dados.fechamento,
        vencimento: dados.vencimento,
        melhorDiaCompra: calcularMelhorDiaCompra(dados.fechamento),
        perfil: dados.perfil,
        contaId: dados.contaId,
        usuarioId: dados.usuarioId,
        final4: dados.final4,
        dadosPlasticosCifrados: dados.dadosPlasticosCifrados,
      })
      .returning();
    return resposta.status(201).send(cartao_publico(criado!));
  });

  app.get("/", async (requisicao) => {
    const { usuarioId } = requisicao.query as { usuarioId?: string };
    const banco = obter_banco();
    if (!usuarioId) {
      const linhas = await banco.select().from(cartao).where(eq(cartao.ativo, true));
      return linhas.map(cartao_publico);
    }
    const workspaceId = await garantir_workspace_do_usuario(banco, usuarioId);
    const linhas = await banco
      .select()
      .from(cartao)
      .where(
        and(
          eq(cartao.usuarioId, usuarioId),
          eq(cartao.workspaceId, workspaceId),
          eq(cartao.ativo, true),
        ),
      );
    return linhas.map(cartao_publico);
  });

  app.get("/:id", async (requisicao, resposta) => {
    const { id } = requisicao.params as { id: string };
    const banco = obter_banco();
    const [encontrado] = await banco.select().from(cartao).where(eq(cartao.id, id)).limit(1);
    if (!encontrado || !encontrado.ativo) {
      return resposta.status(404).send({ erro: "Cartão não encontrado." });
    }
    return cartao_publico(encontrado);
  });

  app.patch("/:id", async (requisicao, resposta) => {
    const { id } = requisicao.params as { id: string };
    const dados = schemaPatchCartaoApi.parse(requisicao.body);
    const banco = obter_banco();
    const workspaceId = await garantir_workspace_do_usuario(banco, dados.usuarioId);

    const [existente] = await banco
      .select()
      .from(cartao)
      .where(
        and(
          eq(cartao.id, id),
          eq(cartao.usuarioId, dados.usuarioId),
          eq(cartao.workspaceId, workspaceId),
          eq(cartao.ativo, true),
        ),
      )
      .limit(1);

    if (!existente) {
      return resposta.status(404).send({ erro: "Cartão não encontrado." });
    }

    if (
      existente.sincronizada &&
      (dados.limite != null ||
        dados.fechamento != null ||
        dados.vencimento != null ||
        dados.contaId !== undefined)
    ) {
      return resposta.status(400).send({
        erro: "Cartão sincronizado: limite, datas e conta vinculada vêm do banco.",
      });
    }

    const valores: Partial<typeof cartao.$inferInsert> = { dataAtualizacao: new Date() };
    if (dados.nome != null) valores.nome = dados.nome;
    if (dados.perfil != null) valores.perfil = dados.perfil;
    if (dados.limite != null) valores.limite = String(dados.limite);
    if (dados.fechamento != null) {
      valores.fechamento = dados.fechamento;
      valores.melhorDiaCompra = calcularMelhorDiaCompra(dados.fechamento);
    }
    if (dados.vencimento != null) valores.vencimento = dados.vencimento;
    if (dados.contaId !== undefined) valores.contaId = dados.contaId;

    if (Object.keys(valores).length === 1) {
      return resposta.status(400).send({ erro: "Nenhum campo para atualizar." });
    }

    const [atualizado] = await banco
      .update(cartao)
      .set(valores)
      .where(eq(cartao.id, id))
      .returning();

    return cartao_publico(atualizado!);
  });

  app.delete("/:id", async (requisicao, resposta) => {
    const { id } = requisicao.params as { id: string };
    const dados = schemaExcluirCartaoApi.parse(requisicao.body);
    const banco = obter_banco();
    const workspaceId = await garantir_workspace_do_usuario(banco, dados.usuarioId);

    const [existente] = await banco
      .select()
      .from(cartao)
      .where(
        and(
          eq(cartao.id, id),
          eq(cartao.usuarioId, dados.usuarioId),
          eq(cartao.workspaceId, workspaceId),
          eq(cartao.ativo, true),
        ),
      )
      .limit(1);

    if (!existente) {
      return resposta.status(404).send({ erro: "Cartão não encontrado." });
    }

    const [removido] = await banco
      .update(cartao)
      .set({ ativo: false, dataAtualizacao: new Date() })
      .where(eq(cartao.id, id))
      .returning();

    return cartao_publico(removido!);
  });
}
