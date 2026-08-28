import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  ErroConexaoExternaInexistente,
  type ResumoIngestao,
  type ServicoConexaoOpenFinance,
} from "@lancai/open-finance";
import { cabecalhos_stream_ndjson } from "../cors";
import {
  schemaAssociarContaExterna,
  schemaAtualizarItemId,
  schemaCriarConexaoDuble,
  schemaIniciarConexao,
  schemaInspecionarItem,
  schemaReatacharConexao,
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
import { liberar_lock_sync, tentar_adquirir_lock_sync } from "../servicos/lock-sync-conexao";
import { obter_servico_conexao, obter_servico_ingestao } from "../servicos/open-finance";
import { enriquecer_apos_ingestao } from "../servicos/pos-ingestao-open-finance";
import { filtrar_criacao_semantica_of } from "../servicos/skip-semantico-of";

const MSG_ITEM_SALVO_INEXISTENTE =
  "Este item não existe mais no Meu Pluggy. A conexão foi desconectada. Cole um itemId novo para reconectar.";
const MSG_ITEM_ID_NAO_ENCONTRADO =
  "Não encontramos este itemId no Meu Pluggy. Confira e cole um ID válido.";

function fonte_desativada(resposta: FastifyReply) {
  return resposta.status(503).send({ erro: "Fonte Open Finance desativada." });
}

/**
 * 404 no inspect: só desconecta a conexão informada, e só se o UUID for o
 * `idExterno` dela. Confere dono antes — UUID morto aleatório não derruba.
 */
async function desconectar_se_inspecao_do_item_salvo(
  servico: ServicoConexaoOpenFinance,
  dados: { usuarioId: string; conexaoExterna: string; conexaoId?: string },
): Promise<boolean> {
  if (!dados.conexaoId) return false;
  try {
    const acesso = await exigir_conexao_do_usuario(servico, dados.conexaoId, dados.usuarioId);
    if ("erro" in acesso) return false;
    return servico.marcar_removida_se_item_salvo_inexistente(
      dados.conexaoId,
      dados.conexaoExterna,
    );
  } catch {
    return false;
  }
}

async function iniciar_stream_ndjson(requisicao: FastifyRequest, resposta: FastifyReply) {
  const origem =
    typeof requisicao.headers.origin === "string" ? requisicao.headers.origin : undefined;
  resposta.hijack();
  resposta.raw.writeHead(200, await cabecalhos_stream_ndjson(origem));
}

function escritor_ndjson(resposta: FastifyReply) {
  let encerrado = false;
  const escrever = (evento: Record<string, unknown>) => {
    if (encerrado) return;
    resposta.raw.write(`${JSON.stringify(evento)}\n`);
  };
  const encerrar = () => {
    if (encerrado) return;
    encerrado = true;
    resposta.raw.end();
  };
  return { escrever, encerrar };
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

  /**
   * Preview de um itemId (Meu Pluggy) sem gravar conexão — passo 1 do Reconectar.
   */
  app.post("/conexoes/inspecionar", async (requisicao, resposta) => {
    const servico = obter_servico_conexao();
    if (!servico) return fonte_desativada(resposta);

    const dados = schemaInspecionarItem.parse(requisicao.body);
    await exigir_workspace_escrita(dados.usuarioId);

    try {
      return resposta.send(await servico.inspecionar_item(dados.conexaoExterna));
    } catch (erro) {
      if (erro instanceof ErroConexaoExternaInexistente) {
        const desconectou = await desconectar_se_inspecao_do_item_salvo(servico, dados);
        return resposta.status(400).send({
          erro: desconectou ? MSG_ITEM_SALVO_INEXISTENTE : MSG_ITEM_ID_NAO_ENCONTRADO,
          ...(desconectou ? { conexaoDesconectada: true } : {}),
        });
      }
      const msg = erro instanceof Error ? erro.message : "Falha ao inspecionar item.";
      return resposta.status(400).send({
        erro: msg.startsWith("provedor indisponível:")
          ? "Não foi possível ler este item no provedor. Confira o itemId."
          : msg,
      });
    }
  });

  /**
   * Reconectar: com conexaoId, atualiza o item in-place; sem, registra o item
   * e adota conta/cartão órfão. Depois sincroniza o extrato (NDJSON).
   */
  app.post("/conexoes/reatachar", async (requisicao, resposta) => {
    const servico = obter_servico_conexao();
    if (!servico) return fonte_desativada(resposta);

    const dados = schemaReatacharConexao.parse(requisicao.body);
    const workspaceId = await exigir_workspace_escrita(dados.usuarioId);
    const conexaoAlvo = dados.conexaoId ?? dados.conexaoIdAnterior;

    if (conexaoAlvo) {
      const acesso = await exigir_conexao_do_usuario(servico, conexaoAlvo, dados.usuarioId);
      if ("erro" in acesso) return resposta.status(404).send(acesso);
    }

    await iniciar_stream_ndjson(requisicao, resposta);
    const { escrever, encerrar } = escritor_ndjson(resposta);

    let conexaoIdLock: string | null = null;
    let resumoIngestao: ResumoIngestao | null = null;

    try {
      escrever({
        tipo: "progresso",
        percentual: 4,
        mensagem: "Atualizando conexão e associando contas…",
        criados: 0,
        duplicados: 0,
        contaAtual: 0,
        contasTotal: 0,
      });

      const detalhe = await servico.reatachar_conexao({
        workspaceId,
        usuarioId: dados.usuarioId,
        conexaoExterna: dados.conexaoExterna,
        pareamentos: dados.pareamentos,
        conexaoId: conexaoAlvo,
        alvoContaId: dados.alvoContaId,
        alvoCartaoId: dados.alvoCartaoId,
      });

      conexaoIdLock = detalhe.conexao.id;
      if (!tentar_adquirir_lock_sync(conexaoIdLock)) {
        escrever({
          tipo: "erro",
          erro: "Já existe uma sincronização em andamento para esta conexão.",
        });
        return;
      }

      escrever({
        tipo: "progresso",
        percentual: 12,
        mensagem: "Sincronizando extrato (só lançamentos novos)…",
        criados: 0,
        duplicados: 0,
        contaAtual: 0,
        contasTotal: 0,
      });

      const ingestao = obter_servico_ingestao();
      if (!ingestao) {
        escrever({ tipo: "erro", erro: "Ingestão Open Finance indisponível." });
        return;
      }

      resumoIngestao = await ingestao.importar_historico(conexaoIdLock, {
        lookbackDias: 365,
        filtrarCriacao: filtrar_criacao_semantica_of,
        aoProgresso: (progresso) => {
          escrever({ tipo: "progresso", ...progresso });
        },
      });

      requisicao.log.info(
        {
          evento: "SYNC_REATTACH_OK",
          conexaoId: conexaoIdLock,
          criados: resumoIngestao.criados,
          duplicados: resumoIngestao.duplicados,
          puladosSemanticos: resumoIngestao.puladosSemanticos,
        },
        "[open-finance] SYNC_REATTACH_OK",
      );

      escrever({
        tipo: "fim",
        detalhe: await servico.detalhar(conexaoIdLock),
        resumo: {
          criados: resumoIngestao.criados,
          duplicados: resumoIngestao.duplicados,
          atualizados: resumoIngestao.atualizados,
          puladosSemanticos: resumoIngestao.puladosSemanticos,
          semDestino: resumoIngestao.semDestino,
          paginas: resumoIngestao.paginas,
        },
      });
    } catch (erro) {
      if (erro instanceof ErroConexaoExternaInexistente) {
        const desconectou = conexaoAlvo
          ? await servico.marcar_removida_se_item_salvo_inexistente(
              conexaoAlvo,
              dados.conexaoExterna,
            )
          : false;
        escrever({
          tipo: "erro",
          erro: desconectou ? MSG_ITEM_SALVO_INEXISTENTE : MSG_ITEM_ID_NAO_ENCONTRADO,
          conexaoDesconectada: desconectou,
        });
      } else {
        const bruto = erro instanceof Error ? erro.message : "Falha ao reconectar o banco.";
        requisicao.log.error({ err: erro }, "[open-finance] falha no reconectar");
        escrever({
          tipo: "erro",
          erro: bruto.startsWith("provedor indisponível:")
            ? "Não foi possível ler o extrato no banco agora. Tente de novo em instantes."
            : bruto,
        });
      }
    } finally {
      encerrar();
    }

    if (conexaoIdLock && resumoIngestao) {
      try {
        await enriquecer_apos_ingestao({
          eventoId: `reatachar:${conexaoIdLock}:${Date.now()}`,
          resumo: resumoIngestao,
          log: requisicao.log,
        });
      } catch (erro) {
        requisicao.log.error({ err: erro }, "[open-finance] falha ao enriquecer após reconectar");
      }
    }
    if (conexaoIdLock) liberar_lock_sync(conexaoIdLock);
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

    await iniciar_stream_ndjson(requisicao, resposta);
    const { escrever, encerrar } = escritor_ndjson(resposta);

    if (!tentar_adquirir_lock_sync(id)) {
      escrever({
        tipo: "erro",
        erro: "Já existe uma sincronização em andamento para esta conexão. Aguarde e tente de novo.",
      });
      encerrar();
      return;
    }

    let resumoIngestao: ResumoIngestao | null = null;
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
        resumoIngestao = await ingestao.importar_historico(id, {
          filtrarCriacao: filtrar_criacao_semantica_of,
          aoProgresso: (progresso) => {
            escrever({ tipo: "progresso", ...progresso });
          },
        });
        requisicao.log.info(
          {
            conexaoId: id,
            criados: resumoIngestao.criados,
            duplicados: resumoIngestao.duplicados,
            semDestino: resumoIngestao.semDestino,
            paginas: resumoIngestao.paginas,
          },
          "[open-finance] histórico importado",
        );
        escrever({
          tipo: "fim",
          detalhe: await servico.detalhar(id),
          resumo: {
            criados: resumoIngestao.criados,
            duplicados: resumoIngestao.duplicados,
            semDestino: resumoIngestao.semDestino,
            paginas: resumoIngestao.paginas,
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
      if (erro instanceof ErroConexaoExternaInexistente) {
        requisicao.log.info({ conexaoId: id }, "[open-finance] item inexistente no atualizar");
        escrever({
          tipo: "fim",
          detalhe: await servico.detalhar(id),
          resumo: { criados: 0, duplicados: 0, semDestino: 0, paginas: 0 },
        });
      } else {
        const bruto = erro instanceof Error ? erro.message : "Falha ao atualizar conexão.";
        requisicao.log.error({ err: erro, conexaoId: id }, "[open-finance] falha no atualizar");
        escrever({
          tipo: "erro",
          erro: bruto.startsWith("provedor indisponível:")
            ? "Não foi possível ler o extrato no banco agora. Tente de novo em instantes."
            : bruto,
        });
      }
    } finally {
      encerrar();
    }

    if (resumoIngestao) {
      try {
        await enriquecer_apos_ingestao({
          eventoId: `importar-historico:${id}:${Date.now()}`,
          resumo: resumoIngestao,
          log: requisicao.log,
        });
      } catch (erro) {
        requisicao.log.error({ err: erro, conexaoId: id }, "[open-finance] falha ao enriquecer após atualizar");
      }
    }
    liberar_lock_sync(id);
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
   * Fallback Meu Pluggy: o item antigo sumiu do provedor e o Meu Pluggy
   * gerou um novo itemId. O usuário informa o novo itemId e atualizamos
   * a conexão preservando associações e histórico local.
   */
  app.post("/conexoes/:id/item-id", async (requisicao, resposta) => {
    const servico = obter_servico_conexao();
    if (!servico) return fonte_desativada(resposta);

    const { id } = requisicao.params as { id: string };
    const dados = schemaAtualizarItemId.parse(requisicao.body);

    const acesso = await exigir_conexao_do_usuario(servico, id, dados.usuarioId);
    if ("erro" in acesso) return resposta.status(404).send(acesso);

    try {
      return resposta.send(await servico.atualizar_item_id(id, dados.novoItemId));
    } catch (erro) {
      const msg = erro instanceof Error ? erro.message : "Falha ao atualizar itemId.";
      requisicao.log.error({ err: erro, conexaoId: id }, "[open-finance] falha ao atualizar itemId");
      return resposta.status(400).send({ erro: msg });
    }
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
