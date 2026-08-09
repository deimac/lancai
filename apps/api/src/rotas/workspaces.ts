import type { FastifyInstance } from "fastify";
import {
  atualizar_workspace_do_usuario,
  criar_workspace_do_usuario,
  definir_membros_workspace,
  definir_workspace_ativo,
  ErroWorkspaceMembroInvalido,
  ErroWorkspaceNaoEncontrado,
  ErroWorkspaceNaoPodeExcluir,
  ErroWorkspaceSemMembros,
  excluir_workspace_do_usuario,
  garantir_workspace_do_usuario,
  listar_workspaces_do_usuario,
  obter_banco,
} from "@lancai/banco";
import {
  schemaAtualizarWorkspace,
  schemaCriarWorkspace,
  schemaDefinirWorkspaceAtivo,
  schemaExcluirWorkspaceApi,
  schemaMembrosWorkspace,
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
      cor: dados.cor,
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

  async function tratar_membros(
    id: string,
    body: unknown,
    resposta: import("fastify").FastifyReply,
  ) {
    const dados = schemaMembrosWorkspace.parse(body);
    const banco = obter_banco();
    try {
      return await definir_membros_workspace(banco, dados.usuarioId, id, {
        contaIds: dados.contaIds,
        cartaoIds: dados.cartaoIds,
      });
    } catch (erro) {
      if (erro instanceof ErroWorkspaceNaoEncontrado) {
        return resposta.status(404).send({ erro: erro.message });
      }
      if (
        erro instanceof ErroWorkspaceSemMembros ||
        erro instanceof ErroWorkspaceMembroInvalido
      ) {
        return resposta.status(400).send({ erro: erro.message });
      }
      throw erro;
    }
  }

  // Rotas mais específicas antes de `/:id`
  app.post("/:id/membros", async (requisicao, resposta) => {
    const { id } = requisicao.params as { id: string };
    return tratar_membros(id, requisicao.body, resposta);
  });

  app.put("/:id/membros", async (requisicao, resposta) => {
    const { id } = requisicao.params as { id: string };
    return tratar_membros(id, requisicao.body, resposta);
  });

  app.patch("/:id", async (requisicao, resposta) => {
    const { id } = requisicao.params as { id: string };
    const dados = schemaAtualizarWorkspace.parse(requisicao.body);
    const banco = obter_banco();
    try {
      return await atualizar_workspace_do_usuario(banco, dados.usuarioId, id, {
        nome: dados.nome,
        descricao: dados.descricao,
        cor: dados.cor,
      });
    } catch (erro) {
      if (erro instanceof ErroWorkspaceNaoEncontrado) {
        return resposta.status(404).send({ erro: erro.message });
      }
      throw erro;
    }
  });

  app.delete("/:id", async (requisicao, resposta) => {
    const { id } = requisicao.params as { id: string };
    const dados = schemaExcluirWorkspaceApi.parse({
      usuarioId: (requisicao.query as { usuarioId?: string }).usuarioId,
    });
    const banco = obter_banco();
    try {
      await excluir_workspace_do_usuario(banco, dados.usuarioId, id);
      return resposta.status(204).send();
    } catch (erro) {
      if (erro instanceof ErroWorkspaceNaoEncontrado) {
        return resposta.status(404).send({ erro: erro.message });
      }
      if (erro instanceof ErroWorkspaceNaoPodeExcluir) {
        return resposta.status(400).send({ erro: erro.message });
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
