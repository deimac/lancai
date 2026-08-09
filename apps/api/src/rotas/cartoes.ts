import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { cartao, mapear_nomes_workspaces, obter_banco } from "@lancai/banco";
import {
  calcularMelhorDiaCompra,
  schemaCriarCartao,
  schemaExcluirCartaoApi,
  schemaPatchCartaoApi,
} from "@lancai/tipos";
import { exigir_workspace_escrita, obter_escopo_leitura } from "../servicos/escopo-workspace";
import { mapear_origem_cartoes, type MetaOrigem } from "../servicos/origem-conta-cartao";

function cartao_publico<
  T extends {
    dadosPlasticosCifrados?: string | null;
    id: string;
    sincronizada: boolean;
    workspaceId: string;
  },
>(linha: T, meta: MetaOrigem | undefined, nomes: Map<string, string>) {
  const { dadosPlasticosCifrados: _omitido, ...publico } = linha;
  const origem = meta ?? {
    origem: linha.sincronizada ? ("open_finance" as const) : ("manual" as const),
    conexaoId: null,
    instituicao: null,
    idExterno: null,
  };
  return {
    ...publico,
    ...origem,
    workspaceNome: nomes.get(linha.workspaceId) ?? null,
  };
}

export async function registrar_rotas_cartao(app: FastifyInstance) {
  app.post("/", async (requisicao, resposta) => {
    const dados = schemaCriarCartao.parse(requisicao.body);
    const banco = obter_banco();
    const workspaceId = await exigir_workspace_escrita(dados.usuarioId);
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
    const nomes = await mapear_nomes_workspaces(banco, [workspaceId]);
    return resposta.status(201).send(
      cartao_publico(
        criado!,
        {
          origem: "manual",
          conexaoId: null,
          instituicao: null,
          idExterno: null,
        },
        nomes,
      ),
    );
  });

  app.get("/", async (requisicao) => {
    const { usuarioId } = requisicao.query as { usuarioId?: string };
    const banco = obter_banco();
    if (!usuarioId) {
      const linhas = await banco.select().from(cartao).where(eq(cartao.ativo, true));
      return linhas.map((linha) => cartao_publico(linha, undefined, new Map()));
    }
    const escopo = await obter_escopo_leitura(usuarioId);
    if (escopo.workspaceIds.length === 0) return [];

    const linhas = await banco
      .select()
      .from(cartao)
      .where(
        and(
          eq(cartao.usuarioId, usuarioId),
          inArray(cartao.workspaceId, escopo.workspaceIds),
          eq(cartao.ativo, true),
        ),
      );
    const origem = await mapear_origem_cartoes(linhas.map((item) => item.id));
    const nomes = await mapear_nomes_workspaces(
      banco,
      linhas.map((item) => item.workspaceId),
    );
    return linhas.map((linha) => cartao_publico(linha, origem.get(linha.id), nomes));
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
    const escopo = await obter_escopo_leitura(dados.usuarioId);

    const [existente] = await banco
      .select()
      .from(cartao)
      .where(
        and(
          eq(cartao.id, id),
          eq(cartao.usuarioId, dados.usuarioId),
          inArray(cartao.workspaceId, escopo.workspaceIds),
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

    const nomes = await mapear_nomes_workspaces(banco, [atualizado!.workspaceId]);
    const origem = await mapear_origem_cartoes([atualizado!.id]);
    return cartao_publico(atualizado!, origem.get(atualizado!.id), nomes);
  });

  app.delete("/:id", async (requisicao, resposta) => {
    const { id } = requisicao.params as { id: string };
    const dados = schemaExcluirCartaoApi.parse(requisicao.body);
    const banco = obter_banco();
    const escopo = await obter_escopo_leitura(dados.usuarioId);

    const [existente] = await banco
      .select()
      .from(cartao)
      .where(
        and(
          eq(cartao.id, id),
          eq(cartao.usuarioId, dados.usuarioId),
          inArray(cartao.workspaceId, escopo.workspaceIds),
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

    const nomes = await mapear_nomes_workspaces(banco, [removido!.workspaceId]);
    return cartao_publico(removido!, undefined, nomes);
  });
}
