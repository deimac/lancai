import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import {
  cartao,
  faturaOficial,
  mapear_nomes_workspaces,
  movimento,
  obter_banco,
  usuario as usuarioTabela,
} from "@lancai/banco";
import {
  decifrar_dados_plasticos,
  mascara_final4_do_payload,
  preparar_persistencia_plasticos,
} from "@lancai/ia";
import {
  calcularMelhorDiaCompra,
  schemaCriarCartao,
  schemaExcluirCartaoApi,
  schemaPatchCartaoApi,
  schemaRevelarPlasticoApi,
} from "@lancai/tipos";
import {
  exigir_workspace_escrita,
  obter_escopo_leitura,
  obter_workspaces_do_usuario,
} from "../servicos/escopo-workspace";
import { excluir_destino_financeiro } from "../servicos/excluir-destino-financeiro";
import { mapear_origem_cartoes, type MetaOrigem } from "../servicos/origem-conta-cartao";
import { verificar_senha_usuario } from "../verificar-senha-usuario";

function cartao_publico<
  T extends {
    dadosPlasticosCifrados?: string | null;
    id: string;
    sincronizada: boolean;
    workspaceId: string;
  },
>(linha: T, meta: MetaOrigem | undefined, nomes: Map<string, string>) {
  const { dadosPlasticosCifrados, ...resto } = linha;
  const origem = meta ?? {
    origem: linha.sincronizada ? ("open_finance" as const) : ("manual" as const),
    conexaoId: null,
    instituicao: null,
    idExterno: null,
    conexaoStatus: null,
    ultimoSyncEm: null,
  };
  return {
    ...resto,
    temPlastico: Boolean(dadosPlasticosCifrados),
    /** Máscara derivada na leitura (decifra o blob); nunca persiste como coluna. */
    final4: mascara_final4_do_payload(dadosPlasticosCifrados),
    ...origem,
    workspaceNome: nomes.get(linha.workspaceId) ?? null,
  };
}

function resolver_plasticos(dados: {
  plastico?: { numero: string; validade: string; cvv: string };
  dadosPlasticosCifrados?: string;
}): { dadosPlasticosCifrados?: string } {
  if (dados.plastico) {
    const preparado = preparar_persistencia_plasticos(dados.plastico);
    return { dadosPlasticosCifrados: preparado.dadosPlasticosCifrados };
  }
  if (dados.dadosPlasticosCifrados != null) {
    return { dadosPlasticosCifrados: dados.dadosPlasticosCifrados };
  }
  return {};
}

export async function registrar_rotas_cartao(app: FastifyInstance) {
  app.post("/", async (requisicao, resposta) => {
    const dados = schemaCriarCartao.parse(requisicao.body);
    const banco = obter_banco();
    const workspaceId = await exigir_workspace_escrita(dados.usuarioId);
    const plasticos = resolver_plasticos(dados);
    const [criado] = await banco
      .insert(cartao)
      .values({
        workspaceId,
        nome: dados.nome,
        limite: String(dados.limite),
        saldo: String(dados.saldo ?? 0),
        fechamento: dados.fechamento,
        vencimento: dados.vencimento,
        melhorDiaCompra: calcularMelhorDiaCompra(dados.fechamento),
        perfil: dados.perfil,
        contaId: dados.contaId,
        usuarioId: dados.usuarioId,
        dadosPlasticosCifrados: plasticos.dadosPlasticosCifrados,
      })
      .returning();
    const nomes = await mapear_nomes_workspaces(banco, [workspaceId]);
    return resposta.status(201).send(
      cartao_publico(
        criado!,
        {
          origem: "manual",
          conexaoId: null,
          instituicao: null,
          idExterno: null,
          conexaoStatus: null,
          ultimoSyncEm: null,
        },
        nomes,
      ),
    );
  });

  app.get("/", async (requisicao) => {
    const { usuarioId, todos } = requisicao.query as { usuarioId?: string; todos?: string };
    const banco = obter_banco();
    if (!usuarioId) {
      const linhas = await banco.select().from(cartao).where(eq(cartao.ativo, true));
      return linhas.map((linha) => cartao_publico(linha, undefined, new Map()));
    }
    // Default: escopo do workspace (extrato/relatórios). `todos=1`: menu Contas (global).
    const workspaceIds =
      todos === "1"
        ? await obter_workspaces_do_usuario(usuarioId)
        : (await obter_escopo_leitura(usuarioId)).workspaceIds;
    if (workspaceIds.length === 0) return [];

    const linhas = await banco
      .select()
      .from(cartao)
      .where(
        and(
          eq(cartao.usuarioId, usuarioId),
          inArray(cartao.workspaceId, workspaceIds),
          eq(cartao.ativo, true),
        ),
      );
    const origem = await mapear_origem_cartoes(linhas.map((item) => item.id));
    const nomes = await mapear_nomes_workspaces(
      banco,
      linhas.map((item) => item.workspaceId),
    );
    const oficiais =
      linhas.length === 0
        ? []
        : await banco
            .select({
              cartaoId: faturaOficial.cartaoId,
              competencia: faturaOficial.competencia,
              total: faturaOficial.total,
            })
            .from(faturaOficial)
            .where(inArray(faturaOficial.cartaoId, linhas.map((item) => item.id)));
    const oficiaisPorCartao = new Map<string, Array<{ competencia: string; total: number }>>();
    for (const fatura of oficiais) {
      const lista = oficiaisPorCartao.get(fatura.cartaoId) ?? [];
      lista.push({ competencia: fatura.competencia, total: Number(fatura.total) });
      oficiaisPorCartao.set(fatura.cartaoId, lista);
    }
    return linhas.map((linha) => ({
      ...cartao_publico(linha, origem.get(linha.id), nomes),
      faturasOficiais: oficiaisPorCartao.get(linha.id) ?? [],
    }));
  });

  /** Registrar antes de `/:id` para evitar ambiguidade de rota. */
  app.post("/:id/revelar", async (requisicao, resposta) => {
    const { id } = requisicao.params as { id: string };
    const dados = schemaRevelarPlasticoApi.parse(requisicao.body);
    const banco = obter_banco();

    const [existente] = await banco
      .select()
      .from(cartao)
      .where(
        and(eq(cartao.id, id), eq(cartao.usuarioId, dados.usuarioId), eq(cartao.ativo, true)),
      )
      .limit(1);

    if (!existente) {
      return resposta.status(404).send({ erro: "Cartão não encontrado." });
    }
    if (!existente.dadosPlasticosCifrados) {
      return resposta.status(400).send({ erro: "Este cartão não tem dados do plástico salvos." });
    }

    const [usuario] = await banco
      .select()
      .from(usuarioTabela)
      .where(eq(usuarioTabela.id, dados.usuarioId))
      .limit(1);
    if (!usuario) {
      return resposta.status(404).send({ erro: "Usuário não encontrado." });
    }

    const senhaOk = await verificar_senha_usuario(usuario.email, dados.senha);
    if (!senhaOk) {
      return resposta.status(401).send({ erro: "Senha incorreta." });
    }

    try {
      const plasticos = decifrar_dados_plasticos(existente.dadosPlasticosCifrados);
      return { numero: plasticos.numero, validade: plasticos.validade, cvv: plasticos.cvv };
    } catch (erro) {
      const mensagem =
        erro instanceof Error
          ? erro.message
          : "Não foi possível decifrar os dados do plástico.";
      requisicao.log.error({ err: erro }, "falha ao decifrar plástico");
      return resposta.status(422).send({ erro: mensagem });
    }
  });

  app.get("/:id", async (requisicao, resposta) => {
    const { id } = requisicao.params as { id: string };
    const banco = obter_banco();
    const [encontrado] = await banco.select().from(cartao).where(eq(cartao.id, id)).limit(1);
    if (!encontrado || !encontrado.ativo) {
      return resposta.status(404).send({ erro: "Cartão não encontrado." });
    }
    const origem = await mapear_origem_cartoes([encontrado.id]);
    const nomes = await mapear_nomes_workspaces(banco, [encontrado.workspaceId]);
    return cartao_publico(encontrado, origem.get(encontrado.id), nomes);
  });

  app.patch("/:id", async (requisicao, resposta) => {
    const { id } = requisicao.params as { id: string };
    const dados = schemaPatchCartaoApi.parse(requisicao.body);
    const banco = obter_banco();

    const [existente] = await banco
      .select()
      .from(cartao)
      .where(
        and(eq(cartao.id, id), eq(cartao.usuarioId, dados.usuarioId), eq(cartao.ativo, true)),
      )
      .limit(1);

    if (!existente) {
      return resposta.status(404).send({ erro: "Cartão não encontrado." });
    }

    if (
      existente.sincronizada &&
      (dados.limite != null || dados.saldo != null || dados.contaId !== undefined)
    ) {
      return resposta.status(400).send({
        erro: "Cartão sincronizado: saldo, limite e conta vinculada vêm do banco.",
      });
    }

    const valores: Partial<typeof cartao.$inferInsert> = { dataAtualizacao: new Date() };
    if (dados.nome != null) valores.nome = dados.nome;
    if (dados.perfil != null) valores.perfil = dados.perfil;
    if (dados.limite != null) valores.limite = String(dados.limite);
    if (dados.saldo != null) valores.saldo = String(dados.saldo);
    if (dados.fechamento != null) {
      valores.fechamento = dados.fechamento;
      valores.melhorDiaCompra = calcularMelhorDiaCompra(dados.fechamento);
    }
    if (dados.vencimento != null) valores.vencimento = dados.vencimento;
    if (dados.contaId !== undefined) valores.contaId = dados.contaId;
    if (dados.plastico) {
      valores.dadosPlasticosCifrados = preparar_persistencia_plasticos(dados.plastico).dadosPlasticosCifrados;
    }

    if (Object.keys(valores).length === 1) {
      return resposta.status(400).send({ erro: "Nenhum campo para atualizar." });
    }

    const [atualizado] = await banco
      .update(cartao)
      .set(valores)
      .where(eq(cartao.id, id))
      .returning();

    // Extrato Open Finance herda o perfil do cartão — alinhar ao salvar.
    if (dados.perfil != null && dados.perfil !== existente.perfil) {
      await banco
        .update(movimento)
        .set({ tipoGasto: dados.perfil, dataAtualizacao: new Date() })
        .where(and(eq(movimento.cartaoId, id), eq(movimento.fonte, "open_finance")));
    }

    const nomes = await mapear_nomes_workspaces(banco, [atualizado!.workspaceId]);
    const origem = await mapear_origem_cartoes([atualizado!.id]);
    return cartao_publico(atualizado!, origem.get(atualizado!.id), nomes);
  });

  app.delete("/:id", async (requisicao, resposta) => {
    const { id } = requisicao.params as { id: string };
    const dados = schemaExcluirCartaoApi.parse(requisicao.body);
    const banco = obter_banco();

    const [existente] = await banco
      .select()
      .from(cartao)
      .where(
        and(eq(cartao.id, id), eq(cartao.usuarioId, dados.usuarioId), eq(cartao.ativo, true)),
      )
      .limit(1);

    if (!existente) {
      return resposta.status(404).send({ erro: "Cartão não encontrado." });
    }

    await excluir_destino_financeiro({
      usuarioId: dados.usuarioId,
      workspaceIds: [existente.workspaceId],
      cartaoId: id,
    });

    // Entidade já apagada — devolve o snapshot pré-exclusão para o cliente.
    const nomes = await mapear_nomes_workspaces(banco, [existente.workspaceId]);
    return cartao_publico(
      { ...existente, ativo: false, dataAtualizacao: new Date() },
      undefined,
      nomes,
    );
  });
}
