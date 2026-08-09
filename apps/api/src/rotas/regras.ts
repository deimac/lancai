import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  garantir_workspace_do_usuario,
  listar_ids_workspaces_dono,
  obter_banco,
} from "@lancai/banco";
import {
  ErroConhecimentoInvalido,
  RepositorioConhecimentoDrizzle,
  ServicoConhecimento,
  acoes_da_regra,
  categoria_id_da_regra,
  condicoes_da_regra,
} from "@lancai/conhecimento";
import type { Regra } from "@lancai/banco";
import {
  logicaCondicoesRegraSchema,
  schemaAcaoRegra,
  schemaAtualizarRegra,
  schemaCondicaoRegra,
} from "@lancai/tipos";

const conhecimento = new ServicoConhecimento(new RepositorioConhecimentoDrizzle());

const schemaListar = z.object({
  usuarioId: z.string().uuid(),
});

const schemaCriarApi = z.object({
  usuarioId: z.string().uuid(),
  nome: z.string().trim().min(1).max(120),
  logicaCondicoes: logicaCondicoesRegraSchema.default("ou"),
  condicoes: z.array(schemaCondicaoRegra).min(1).max(20),
  acoes: z.array(schemaAcaoRegra).min(1).max(10),
  ativa: z.boolean().optional().default(true),
  aplicarExistentes: z.boolean().optional().default(false),
});

const schemaAtualizarApi = schemaAtualizarRegra.extend({
  usuarioId: z.string().uuid(),
});

async function serializar_regra(regra: Regra) {
  const repo = new RepositorioConhecimentoDrizzle();
  const categoriaId = categoria_id_da_regra(regra);
  const categoria = categoriaId ? await repo.obterCategoria(categoriaId) : null;
  return {
    id: regra.id,
    nome: regra.nome,
    origem: regra.origem,
    ativa: regra.ativa,
    logicaCondicoes: regra.logicaCondicoes,
    condicoes: condicoes_da_regra(regra),
    acoes: acoes_da_regra(regra),
    categoriaId,
    categoriaNome: categoria?.nome ?? null,
    dataCriacao: regra.dataCriacao,
  };
}

async function workspaces_do_usuario(usuarioId: string): Promise<string[]> {
  const banco = obter_banco();
  const ids = await listar_ids_workspaces_dono(banco, usuarioId);
  if (ids.length > 0) return ids;
  return [await garantir_workspace_do_usuario(banco, usuarioId)];
}

export async function registrar_rotas_regras(app: FastifyInstance) {
  app.get("/", async (requisicao) => {
    const { usuarioId } = schemaListar.parse(requisicao.query);
    const workspaceIds = await workspaces_do_usuario(usuarioId);
    const regras = await conhecimento.listar_regras(workspaceIds);
    return Promise.all(regras.map((regra) => serializar_regra(regra)));
  });

  app.post("/", async (requisicao, resposta) => {
    const dados = schemaCriarApi.parse(requisicao.body);
    const banco = obter_banco();
    const workspaceId = await garantir_workspace_do_usuario(banco, dados.usuarioId);
    const workspaceIds = await workspaces_do_usuario(dados.usuarioId);

    try {
      const criada = await conhecimento.criar_regra({
        workspaceId,
        origem: "manual",
        nome: dados.nome,
        logicaCondicoes: dados.logicaCondicoes,
        condicoes: dados.condicoes,
        acoes: dados.acoes,
        ativa: dados.ativa,
      });
      if (dados.aplicarExistentes) {
        await conhecimento.aplicar_regras_existentes(workspaceIds);
      }
      return resposta.status(201).send(await serializar_regra(criada));
    } catch (erro) {
      if (erro instanceof ErroConhecimentoInvalido) {
        return resposta.status(400).send({ erro: erro.message });
      }
      throw erro;
    }
  });

  app.patch("/:id", async (requisicao, resposta) => {
    const { id } = requisicao.params as { id: string };
    const dados = schemaAtualizarApi.parse(requisicao.body);
    const workspaceIds = await workspaces_do_usuario(dados.usuarioId);
    const repo = new RepositorioConhecimentoDrizzle();
    const existente = await repo.obterRegra(id);

    if (!existente || !workspaceIds.includes(existente.workspaceId)) {
      return resposta.status(404).send({ erro: "Regra não encontrada." });
    }

    try {
      const { usuarioId: _u, aplicarExistentes, ...campos } = dados;
      const atualizada = await conhecimento.atualizar_regra(id, campos);
      if (aplicarExistentes) {
        await conhecimento.aplicar_regras_existentes(workspaceIds);
      }
      return serializar_regra(atualizada);
    } catch (erro) {
      if (erro instanceof ErroConhecimentoInvalido) {
        return resposta.status(400).send({ erro: erro.message });
      }
      throw erro;
    }
  });

  app.delete("/:id", async (requisicao, resposta) => {
    const { id } = requisicao.params as { id: string };
    const { usuarioId } = schemaListar.parse(requisicao.query);
    const workspaceIds = await workspaces_do_usuario(usuarioId);
    const repo = new RepositorioConhecimentoDrizzle();
    const existente = await repo.obterRegra(id);

    if (!existente || !workspaceIds.includes(existente.workspaceId)) {
      return resposta.status(404).send({ erro: "Regra não encontrada." });
    }

    try {
      await conhecimento.excluir_regra(id);
      return resposta.status(204).send();
    } catch (erro) {
      if (erro instanceof ErroConhecimentoInvalido) {
        return resposta.status(400).send({ erro: erro.message });
      }
      throw erro;
    }
  });
}
