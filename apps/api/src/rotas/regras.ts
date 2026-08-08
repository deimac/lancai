import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { garantir_workspace_do_usuario, obter_banco } from "@lancai/banco";
import {
  ErroConhecimentoInvalido,
  RepositorioConhecimentoDrizzle,
  ServicoConhecimento,
} from "@lancai/conhecimento";
import { perfilSchema } from "@lancai/tipos";

const conhecimento = new ServicoConhecimento(new RepositorioConhecimentoDrizzle());

const schemaListar = z.object({
  usuarioId: z.string().uuid(),
});

const schemaCriar = z.object({
  usuarioId: z.string().uuid(),
  condicaoValor: z.string().trim().min(2).max(120),
  categoriaId: z.string().uuid(),
  perfil: perfilSchema.optional(),
});

const schemaAtualizar = z.object({
  usuarioId: z.string().uuid(),
  ativa: z.boolean(),
});

export async function registrar_rotas_regras(app: FastifyInstance) {
  app.get("/", async (requisicao) => {
    const { usuarioId } = schemaListar.parse(requisicao.query);
    const banco = obter_banco();
    const workspaceId = await garantir_workspace_do_usuario(banco, usuarioId);
    const regras = await conhecimento.listar_regras(workspaceId);
    const repo = new RepositorioConhecimentoDrizzle();

    return Promise.all(
      regras.map(async (regra) => {
        const categoria = await repo.obterCategoria(regra.categoriaId);
        return {
          id: regra.id,
          origem: regra.origem,
          ativa: regra.ativa,
          condicaoTipo: regra.condicaoTipo,
          condicaoValor: regra.condicaoValor,
          categoriaId: regra.categoriaId,
          categoriaNome: categoria?.nome ?? "Categoria",
          perfil: regra.perfil,
          dataCriacao: regra.dataCriacao,
        };
      }),
    );
  });

  app.post("/", async (requisicao, resposta) => {
    const dados = schemaCriar.parse(requisicao.body);
    const banco = obter_banco();
    const workspaceId = await garantir_workspace_do_usuario(banco, dados.usuarioId);

    try {
      const criada = await conhecimento.criar_regra({
        workspaceId,
        origem: "manual",
        condicaoValor: dados.condicaoValor,
        categoriaId: dados.categoriaId,
        perfil: dados.perfil,
      });
      const categoria = await new RepositorioConhecimentoDrizzle().obterCategoria(criada.categoriaId);
      return resposta.status(201).send({
        id: criada.id,
        origem: criada.origem,
        ativa: criada.ativa,
        condicaoTipo: criada.condicaoTipo,
        condicaoValor: criada.condicaoValor,
        categoriaId: criada.categoriaId,
        categoriaNome: categoria?.nome ?? "Categoria",
        perfil: criada.perfil,
        dataCriacao: criada.dataCriacao,
      });
    } catch (erro) {
      if (erro instanceof ErroConhecimentoInvalido) {
        return resposta.status(400).send({ erro: erro.message });
      }
      throw erro;
    }
  });

  app.patch("/:id", async (requisicao, resposta) => {
    const { id } = requisicao.params as { id: string };
    const dados = schemaAtualizar.parse(requisicao.body);
    const banco = obter_banco();
    const workspaceId = await garantir_workspace_do_usuario(banco, dados.usuarioId);
    const repo = new RepositorioConhecimentoDrizzle();
    const existente = await repo.obterRegra(id);

    if (!existente || existente.workspaceId !== workspaceId) {
      return resposta.status(404).send({ erro: "Regra não encontrada." });
    }

    try {
      const atualizada = await conhecimento.definir_ativa_regra(id, dados.ativa);
      const categoria = await repo.obterCategoria(atualizada.categoriaId);
      return {
        id: atualizada.id,
        origem: atualizada.origem,
        ativa: atualizada.ativa,
        condicaoTipo: atualizada.condicaoTipo,
        condicaoValor: atualizada.condicaoValor,
        categoriaId: atualizada.categoriaId,
        categoriaNome: categoria?.nome ?? "Categoria",
        perfil: atualizada.perfil,
        dataCriacao: atualizada.dataCriacao,
      };
    } catch (erro) {
      if (erro instanceof ErroConhecimentoInvalido) {
        return resposta.status(400).send({ erro: erro.message });
      }
      throw erro;
    }
  });
}
