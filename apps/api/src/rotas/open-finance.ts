import type { FastifyInstance, FastifyReply } from "fastify";
import type { ServicoConexaoOpenFinance } from "@lancai/open-finance";
import {
  schemaAssociarContaExterna,
  schemaCriarConexaoDuble,
  schemaIniciarConexao,
  schemaRegistrarConexao,
  schemaSincronizarDuble,
  schemaUsuarioDaRequisicao,
} from "../dtos/open-finance";
import {
  criar_conexao_duble,
  ErroConexaoDubleNaoEncontrada,
  ErroDubleIndisponivel,
  ErroDubleSemAssociacao,
  obter_provedor_duble,
  sincronizar_conexao_duble,
} from "../servicos/duble-open-finance";
import {
  exigir_workspace_escrita,
  obter_escopo_leitura,
  obter_workspaces_do_usuario,
} from "../servicos/escopo-workspace";
import { obter_servico_conexao, obter_servico_ingestao } from "../servicos/open-finance";
import { enriquecer_apos_ingestao } from "../servicos/pos-ingestao-open-finance";

function fonte_desativada(resposta: FastifyReply) {
  return resposta.status(503).send({ erro: "Fonte Open Finance desativada." });
}

/**
 * Conexão é global do menu Contas (pertence ao usuário). Checamos se o pouso
 * técnico (`workspace_id`) está em algum workspace em que ele é dono — não no
 * workspace ativo da UI.
 */
async function exigir_conexao_do_usuario(
  servico: ServicoConexaoOpenFinance,
  conexaoId: string,
  usuarioId: string,
) {
  const workspaceIds = await obter_workspaces_do_usuario(usuarioId);
  const detalhe = await servico.detalhar(conexaoId);

  /**
   * Mesma resposta de conexão inexistente, de propósito: distinguir "não existe"
   * de "não é sua" conta quem sonda identificadores quais deles são válidos.
   */
  if (!workspaceIds.includes(detalhe.conexao.workspaceId)) {
    return { erro: `conexão não encontrada: ${conexaoId}` } as const;
  }

  return { detalhe, workspaceId: detalhe.conexao.workspaceId, workspaceIds } as const;
}

export async function registrar_rotas_open_finance(app: FastifyInstance) {
  /** Passo 1 do fluxo: é isto que impede o provedor de vazar para o frontend. */
  app.get("/fonte", async (_requisicao, resposta) => {
    const servico = obter_servico_conexao();
    if (!servico) return resposta.send({ disponivel: false });
    return resposta.send(servico.descrever_fonte());
  });

  app.post("/conexoes/token", async (requisicao, resposta) => {
    const servico = obter_servico_conexao();
    if (!servico) return fonte_desativada(resposta);

    const dados = schemaIniciarConexao.parse(requisicao.body);
    // Confirma workspace ativo (pouso técnico no schema); clientUserId = usuarioId.
    await exigir_workspace_escrita(dados.usuarioId);

    if (dados.conexaoId) {
      const acesso = await exigir_conexao_do_usuario(servico, dados.conexaoId, dados.usuarioId);
      if ("erro" in acesso) return resposta.status(404).send(acesso);
    }

    const token = await servico.iniciar_conexao({
      usuarioId: dados.usuarioId,
      conexaoId: dados.conexaoId,
    });
    return resposta.send(token);
  });

  app.post("/conexoes", async (requisicao, resposta) => {
    const servico = obter_servico_conexao();
    if (!servico) return fonte_desativada(resposta);

    const dados = schemaRegistrarConexao.parse(requisicao.body);
    const workspaceId = await exigir_workspace_escrita(dados.usuarioId);

    const registrada = await servico.registrar_conexao({
      workspaceId,
      usuarioId: dados.usuarioId,
      conexaoExterna: dados.conexaoExterna,
    });

    return resposta.status(201).send(registrada);
  });

  app.get("/conexoes", async (requisicao, resposta) => {
    const servico = obter_servico_conexao();
    if (!servico) return fonte_desativada(resposta);

    const { usuarioId } = schemaUsuarioDaRequisicao.parse(requisicao.query);
    // Global: todas as conexões do usuário (fluxo do menu Contas).
    const workspaceIds = await obter_workspaces_do_usuario(usuarioId);

    return resposta.send(await servico.listar_conexoes(workspaceIds));
  });

  app.get("/conexoes/:id", async (requisicao, resposta) => {
    const servico = obter_servico_conexao();
    if (!servico) return fonte_desativada(resposta);

    const { id } = requisicao.params as { id: string };
    const { usuarioId } = schemaUsuarioDaRequisicao.parse(requisicao.query);

    const acesso = await exigir_conexao_do_usuario(servico, id, usuarioId);
    if ("erro" in acesso) return resposta.status(404).send(acesso);

    return resposta.send(acesso.detalhe);
  });

  /**
   * “Atualizar agora”: refresca saldo/limite, tenta sync pontual (best-effort)
   * e importa o extrato via GET. Resposta em NDJSON com progresso percentual
   * (`tipo: progresso` / `fim` / `erro`) para a barra da UI.
   */
  app.post("/conexoes/:id/atualizar", async (requisicao, resposta) => {
    const servico = obter_servico_conexao();
    if (!servico) return fonte_desativada(resposta);

    const { id } = requisicao.params as { id: string };
    const { usuarioId } = schemaUsuarioDaRequisicao.parse(requisicao.body);

    const acesso = await exigir_conexao_do_usuario(servico, id, usuarioId);
    if ("erro" in acesso) return resposta.status(404).send(acesso);

    resposta.hijack();
    resposta.raw.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });

    const escrever = (evento: Record<string, unknown>) => {
      resposta.raw.write(`${JSON.stringify(evento)}\n`);
    };

    try {
      escrever({
        tipo: "progresso",
        percentual: 4,
        mensagem: "Atualizando saldos…",
        criados: 0,
        duplicados: 0,
        contaAtual: 0,
        contasTotal: 0,
      });

      await servico.solicitar_atualizacao(id);

      escrever({
        tipo: "progresso",
        percentual: 12,
        mensagem: "Importando extrato…",
        criados: 0,
        duplicados: 0,
        contaAtual: 0,
        contasTotal: 0,
      });

      const ingestao = obter_servico_ingestao();
      if (ingestao) {
        const resumo = await ingestao.importar_historico(id, {
          aoProgresso: (progresso) => {
            escrever({ tipo: "progresso", ...progresso });
          },
        });
        requisicao.log.info(
          {
            conexaoId: id,
            criados: resumo.criados,
            duplicados: resumo.duplicados,
            semDestino: resumo.semDestino,
            paginas: resumo.paginas,
          },
          "[open-finance] histórico importado",
        );
        await enriquecer_apos_ingestao({
          eventoId: `importar-historico:${id}:${Date.now()}`,
          resumo,
          log: requisicao.log,
        });
        escrever({
          tipo: "fim",
          detalhe: await servico.detalhar(id),
          resumo: {
            criados: resumo.criados,
            duplicados: resumo.duplicados,
            semDestino: resumo.semDestino,
            paginas: resumo.paginas,
          },
        });
      } else {
        escrever({
          tipo: "fim",
          detalhe: await servico.detalhar(id),
          resumo: { criados: 0, duplicados: 0, semDestino: 0, paginas: 0 },
        });
      }
    } catch (erro) {
      const bruto = erro instanceof Error ? erro.message : "Falha ao atualizar conexão.";
      requisicao.log.error({ err: erro, conexaoId: id }, "[open-finance] falha no atualizar");
      escrever({
        tipo: "erro",
        erro: bruto.startsWith("provedor indisponível:")
          ? "Não foi possível ler o extrato no banco agora. Tente de novo em instantes."
          : bruto,
      });
    } finally {
      resposta.raw.end();
    }
  });

  /**
   * Passos 6 e 7. A conta local passa a recusar lançamento manual em qualquer
   * canal, então a interface precisa avisar antes de chamar isto.
   */
  app.put("/conexoes/:id/contas/:contaExternaId", async (requisicao, resposta) => {
    const servico = obter_servico_conexao();
    if (!servico) return fonte_desativada(resposta);

    const { id, contaExternaId } = requisicao.params as { id: string; contaExternaId: string };
    const dados = schemaAssociarContaExterna.parse(requisicao.body);

    const acesso = await exigir_conexao_do_usuario(servico, id, dados.usuarioId);
    if ("erro" in acesso) return resposta.status(404).send(acesso);

    return resposta.send(
      await servico.associar({
        conexaoId: id,
        contaExternaId,
        contaId: dados.contaId,
        cartaoId: dados.cartaoId,
      }),
    );
  });

  app.delete("/conexoes/:id/contas/:contaExternaId", async (requisicao, resposta) => {
    const servico = obter_servico_conexao();
    if (!servico) return fonte_desativada(resposta);

    const { id, contaExternaId } = requisicao.params as { id: string; contaExternaId: string };
    const { usuarioId } = schemaUsuarioDaRequisicao.parse(requisicao.body);

    const acesso = await exigir_conexao_do_usuario(servico, id, usuarioId);
    if ("erro" in acesso) return resposta.status(404).send(acesso);

    return resposta.send(await servico.desassociar({ conexaoId: id, contaExternaId }));
  });

  /**
   * Desconecta a instituição: status removida + desliga sync.
   * Contas, cartões e histórico permanecem no workspace.
   */
  app.post("/conexoes/:id/desconectar", async (requisicao, resposta) => {
    const servico = obter_servico_conexao();
    if (!servico) return fonte_desativada(resposta);

    const { id } = requisicao.params as { id: string };
    const { usuarioId } = schemaUsuarioDaRequisicao.parse(requisicao.body);

    const acesso = await exigir_conexao_do_usuario(servico, id, usuarioId);
    if ("erro" in acesso) return resposta.status(404).send(acesso);

    return resposta.send(await servico.desconectar(id));
  });

  /**
   * Atalhos só do dublê: a tela `/conexoes` usa isto quando não há widget.
   * Com Pluggy (ou Fonte desligada) respondem 404 — não anunciam o caminho.
   */
  app.post("/duble/conexoes", async (requisicao, resposta) => {
    if (!obter_provedor_duble()) {
      return resposta.status(404).send({ erro: "Dublê indisponível neste ambiente." });
    }

    const dados = schemaCriarConexaoDuble.parse(requisicao.body);
    const workspaceId = await exigir_workspace_escrita(dados.usuarioId);

    try {
      const registrada = await criar_conexao_duble({
        workspaceId,
        usuarioId: dados.usuarioId,
      });
      return resposta.status(201).send(registrada);
    } catch (erro) {
      if (erro instanceof ErroDubleIndisponivel) {
        return resposta.status(404).send({ erro: erro.message });
      }
      throw erro;
    }
  });

  app.post("/duble/conexoes/:id/sincronizar", async (requisicao, resposta) => {
    if (!obter_provedor_duble()) {
      return resposta.status(404).send({ erro: "Dublê indisponível neste ambiente." });
    }

    const { id } = requisicao.params as { id: string };
    const dados = schemaSincronizarDuble.parse(requisicao.body);
    const workspaceId = await exigir_workspace_escrita(dados.usuarioId);

    try {
      const resumo = await sincronizar_conexao_duble({
        conexaoId: id,
        workspaceId,
        log: requisicao.log,
        movimentos: dados.movimentos,
      });
      return resposta.send(resumo);
    } catch (erro) {
      if (erro instanceof ErroDubleIndisponivel) {
        return resposta.status(404).send({ erro: erro.message });
      }
      if (erro instanceof ErroConexaoDubleNaoEncontrada) {
        return resposta.status(404).send({ erro: erro.message });
      }
      if (erro instanceof ErroDubleSemAssociacao) {
        return resposta.status(400).send({ erro: erro.message });
      }
      throw erro;
    }
  });
}
