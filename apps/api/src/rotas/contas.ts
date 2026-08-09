import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { conta, mapear_nomes_workspaces, obter_banco } from "@lancai/banco";
import {
  schemaCriarConta,
  schemaExcluirContaApi,
  schemaPatchContaApi,
} from "@lancai/tipos";
import { exigir_workspace_escrita, obter_escopo_leitura } from "../servicos/escopo-workspace";
import { mapear_origem_contas, type MetaOrigem } from "../servicos/origem-conta-cartao";

function com_meta<T extends { id: string; sincronizada: boolean; workspaceId: string }>(
  linha: T,
  meta: MetaOrigem | undefined,
  nomes: Map<string, string>,
) {
  const origem = meta ?? {
    origem: linha.sincronizada ? ("open_finance" as const) : ("manual" as const),
    conexaoId: null,
    instituicao: null,
    idExterno: null,
  };
  return {
    ...linha,
    ...origem,
    workspaceNome: nomes.get(linha.workspaceId) ?? null,
  };
}

export async function registrar_rotas_conta(app: FastifyInstance) {
  app.post("/", async (requisicao, resposta) => {
    const dados = schemaCriarConta.parse(requisicao.body);
    const banco = obter_banco();
    const workspaceId = await exigir_workspace_escrita(dados.usuarioId);
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
    const nomes = await mapear_nomes_workspaces(banco, [workspaceId]);
    return resposta.status(201).send(
      com_meta(
        criada!,
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
      return banco.select().from(conta).where(eq(conta.ativo, true));
    }
    const escopo = await obter_escopo_leitura(usuarioId);
    if (escopo.workspaceIds.length === 0) return [];

    const linhas = await banco
      .select()
      .from(conta)
      .where(
        and(
          eq(conta.usuarioId, usuarioId),
          inArray(conta.workspaceId, escopo.workspaceIds),
          eq(conta.ativo, true),
        ),
      );
    const origem = await mapear_origem_contas(linhas.map((item) => item.id));
    const nomes = await mapear_nomes_workspaces(
      banco,
      linhas.map((item) => item.workspaceId),
    );
    return linhas.map((linha) => com_meta(linha, origem.get(linha.id), nomes));
  });

  app.get("/:id", async (requisicao, resposta) => {
    const { id } = requisicao.params as { id: string };
    const banco = obter_banco();
    const [encontrada] = await banco.select().from(conta).where(eq(conta.id, id)).limit(1);
    if (!encontrada || !encontrada.ativo) {
      return resposta.status(404).send({ erro: "Conta não encontrada." });
    }
    const origem = await mapear_origem_contas([encontrada.id]);
    const nomes = await mapear_nomes_workspaces(banco, [encontrada.workspaceId]);
    return com_meta(encontrada, origem.get(encontrada.id), nomes);
  });

  app.patch("/:id", async (requisicao, resposta) => {
    const { id } = requisicao.params as { id: string };
    const dados = schemaPatchContaApi.parse(requisicao.body);
    const banco = obter_banco();
    const escopo = await obter_escopo_leitura(dados.usuarioId);

    const [existente] = await banco
      .select()
      .from(conta)
      .where(
        and(
          eq(conta.id, id),
          eq(conta.usuarioId, dados.usuarioId),
          inArray(conta.workspaceId, escopo.workspaceIds),
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

    const nomes = await mapear_nomes_workspaces(banco, [atualizada!.workspaceId]);
    const origem = await mapear_origem_contas([atualizada!.id]);
    return com_meta(atualizada!, origem.get(atualizada!.id), nomes);
  });

  app.delete("/:id", async (requisicao, resposta) => {
    const { id } = requisicao.params as { id: string };
    const dados = schemaExcluirContaApi.parse(requisicao.body);
    const banco = obter_banco();
    const escopo = await obter_escopo_leitura(dados.usuarioId);

    const [existente] = await banco
      .select()
      .from(conta)
      .where(
        and(
          eq(conta.id, id),
          eq(conta.usuarioId, dados.usuarioId),
          inArray(conta.workspaceId, escopo.workspaceIds),
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
