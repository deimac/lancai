import type { FastifyInstance } from "fastify";
import {
  atualizar_workspace_do_usuario,
  criar_workspace_do_usuario,
  definir_workspace_ativo,
  ErroWorkspaceNaoEncontrado,
  garantir_workspace_do_usuario,
  listar_workspaces_do_usuario,
  obter_banco,
} from "@lancai/banco";
import {
  schemaAtualizarWorkspace,
  schemaCriarWorkspace,
  schemaDefinirWorkspaceAtivo,
} from "@lancai/tipos";

export async function registrar_rotas_workspaces(app: FastifyInstance) {
  app.get("/", async (requisicao, resposta) => {
    const { usuarioId } = requisicao.query as { usuarioId?: string };
    if (!usuarioId) {
      return resposta.status(400).send({ erro: "usuarioId é obrigatório." });
    }
    const banco = obter_banco();
    return listar_workspaces_do_usuario(banco, usuarioId);
  });

  app.get("/ativo", async (requisicao, resposta) => {
    const { usuarioId } = requisicao.query as { usuarioId?: string };
    if (!usuarioId) {
      return resposta.status(400).send({ erro: "usuarioId é obrigatório." });
    }
    const banco = obter_banco();
    const lista = await listar_workspaces_do_usuario(banco, usuarioId);
    const ativo = lista.find((item) => item.ativo) ?? null;
    return ativo;
  });

  app.post("/", async (requisicao, resposta) => {
    const dados = schemaCriarWorkspace.parse(requisicao.body);
    const banco = obter_banco();
    const criado = await criar_workspace_do_usuario(banco, dados.usuarioId, {
      nome: dados.nome,
      descricao: dados.descricao,
    });
    return resposta.status(201).send(criado);
  });

  app.post("/ativo", async (requisicao, resposta) => {
    const dados = schemaDefinirWorkspaceAtivo.parse(requisicao.body);
    const banco = obter_banco();
    try {
      return await definir_workspace_ativo(banco, dados.usuarioId, dados.workspaceId);
    } catch (erro) {
      if (erro instanceof ErroWorkspaceNaoEncontrado) {
        return resposta.status(404).send({ erro: erro.message });
      }
      throw erro;
    }
  });

  app.patch("/:id", async (requisicao, resposta) => {
    const { id } = requisicao.params as { id: string };
    const dados = schemaAtualizarWorkspace.parse(requisicao.body);
    const banco = obter_banco();
    try {
      return await atualizar_workspace_do_usuario(banco, dados.usuarioId, id, {
        nome: dados.nome,
        descricao: dados.descricao,
      });
    } catch (erro) {
      if (erro instanceof ErroWorkspaceNaoEncontrado) {
        return resposta.status(404).send({ erro: erro.message });
      }
      throw erro;
    }
  });

  /** Garante workspace real na sincronização de usuário. */
  app.post("/garantir", async (requisicao, resposta) => {
    const { usuarioId } = requisicao.body as { usuarioId?: string };
    if (!usuarioId) {
      return resposta.status(400).send({ erro: "usuarioId é obrigatório." });
    }
    const banco = obter_banco();
    const id = await garantir_workspace_do_usuario(banco, usuarioId);
    const lista = await listar_workspaces_do_usuario(banco, usuarioId);
    return { id, workspaces: lista };
  });
}
