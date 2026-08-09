import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  auditoria as auditoriaTabela,
  categoria as categoriaTabela,
  listar_ids_workspaces_dono,
  movimento as movimentoTabela,
  obter_banco,
  pessoa as pessoaTabela,
  regra as regraTabela,
} from "@lancai/banco";
import type { Movimento, NovaRegra, Regra } from "@lancai/banco";
import { especificidade_regra } from "./avaliar-regra";
import type {
  CamposAtualizarRegra,
  OperacaoConhecimento,
  RepositorioConhecimento,
} from "./repositorio";

export class RepositorioConhecimentoDrizzle implements RepositorioConhecimento {
  private get banco() {
    return obter_banco();
  }

  async obterMovimento(id: string): Promise<Movimento | undefined> {
    const linhas = await this.banco
      .select()
      .from(movimentoTabela)
      .where(eq(movimentoTabela.id, id))
      .limit(1);
    return linhas[0];
  }

  async obterCategoria(id: string): Promise<{ id: string; nome: string } | undefined> {
    const linhas = await this.banco
      .select({ id: categoriaTabela.id, nome: categoriaTabela.nome })
      .from(categoriaTabela)
      .where(eq(categoriaTabela.id, id))
      .limit(1);
    return linhas[0];
  }

  async obterPessoa(id: string): Promise<{ id: string; nome: string } | undefined> {
    const linhas = await this.banco
      .select({ id: pessoaTabela.id, nome: pessoaTabela.nome })
      .from(pessoaTabela)
      .where(eq(pessoaTabela.id, id))
      .limit(1);
    return linhas[0];
  }

  async buscarCategoriaPorNome(
    workspaceId: string,
    nome: string,
  ): Promise<{ id: string; nome: string } | undefined> {
    const alvo = nome.trim().toLocaleLowerCase("pt-BR");
    const linhas = await this.banco
      .select({ id: categoriaTabela.id, nome: categoriaTabela.nome })
      .from(categoriaTabela)
      .where(
        and(eq(categoriaTabela.workspaceId, workspaceId), eq(categoriaTabela.ativo, true)),
      );
    return linhas.find((c) => c.nome.toLocaleLowerCase("pt-BR") === alvo);
  }

  async buscarPessoaPorNome(
    workspaceId: string,
    nome: string,
  ): Promise<{ id: string; nome: string } | undefined> {
    const alvo = nome.trim().toLocaleLowerCase("pt-BR");
    const linhas = await this.banco
      .select({ id: pessoaTabela.id, nome: pessoaTabela.nome })
      .from(pessoaTabela)
      .where(and(eq(pessoaTabela.workspaceId, workspaceId), eq(pessoaTabela.ativo, true)));
    return linhas.find((p) => p.nome.toLocaleLowerCase("pt-BR") === alvo);
  }

  async atualizarConhecimento(operacao: OperacaoConhecimento): Promise<Movimento> {
    return this.banco.transaction(async (tx) => {
      const linhasAtualizadas = await tx
        .update(movimentoTabela)
        .set({ ...operacao.campos, dataAtualizacao: new Date() })
        .where(eq(movimentoTabela.id, operacao.movimentoId))
        .returning();

      const atualizado = linhasAtualizadas[0];
      if (!atualizado) {
        throw new Error(`Movimento não encontrado para atualização: ${operacao.movimentoId}`);
      }

      await tx.insert(auditoriaTabela).values(operacao.auditoria);

      return atualizado;
    });
  }

  async listarRegrasAtivas(workspaceIds: string[]): Promise<Regra[]> {
    if (workspaceIds.length === 0) return [];
    const linhas = await this.banco
      .select()
      .from(regraTabela)
      .where(and(inArray(regraTabela.workspaceId, workspaceIds), eq(regraTabela.ativa, true)))
      .orderBy(asc(regraTabela.dataCriacao));
    return ordenar_por_especificidade(linhas);
  }

  async listarRegras(workspaceIds: string[]): Promise<Regra[]> {
    if (workspaceIds.length === 0) return [];
    const linhas = await this.banco
      .select()
      .from(regraTabela)
      .where(inArray(regraTabela.workspaceId, workspaceIds))
      .orderBy(desc(regraTabela.ativa), asc(regraTabela.dataCriacao));
    return ordenar_por_especificidade(linhas);
  }

  async criarRegra(regra: NovaRegra): Promise<Regra> {
    const [criada] = await this.banco.insert(regraTabela).values(regra).returning();
    if (!criada) throw new Error("Falha ao criar regra.");
    return criada;
  }

  async obterRegra(id: string): Promise<Regra | undefined> {
    const linhas = await this.banco
      .select()
      .from(regraTabela)
      .where(eq(regraTabela.id, id))
      .limit(1);
    return linhas[0];
  }

  async atualizarRegra(id: string, campos: CamposAtualizarRegra): Promise<Regra | undefined> {
    const [atualizada] = await this.banco
      .update(regraTabela)
      .set({ ...campos, dataAtualizacao: new Date() })
      .where(eq(regraTabela.id, id))
      .returning();
    return atualizada;
  }

  async excluirRegra(id: string): Promise<void> {
    await this.banco.delete(regraTabela).where(eq(regraTabela.id, id));
  }

  async listarMovimentoIdsParaRegras(workspaceIds: string[]): Promise<string[]> {
    if (workspaceIds.length === 0) return [];
    const linhas = await this.banco
      .select({ id: movimentoTabela.id })
      .from(movimentoTabela)
      .where(
        and(
          inArray(movimentoTabela.workspaceId, workspaceIds),
          ne(movimentoTabela.status, "cancelado"),
          sql`(${movimentoTabela.classificadoPor} IS DISTINCT FROM 'usuario')`,
        ),
      )
      .orderBy(asc(movimentoTabela.dataCriacao));
    return linhas.map((l) => l.id);
  }

  async listarWorkspaceIdsDoUsuario(usuarioId: string): Promise<string[]> {
    return listar_ids_workspaces_dono(this.banco, usuarioId);
  }

  async listarCategoriasAtivas(
    workspaceId: string,
  ): Promise<Array<{ id: string; nome: string; tipo: string }>> {
    return this.banco
      .select({
        id: categoriaTabela.id,
        nome: categoriaTabela.nome,
        tipo: categoriaTabela.tipo,
      })
      .from(categoriaTabela)
      .where(and(eq(categoriaTabela.workspaceId, workspaceId), eq(categoriaTabela.ativo, true)))
      .orderBy(asc(categoriaTabela.nome));
  }
}

function ordenar_por_especificidade(regras: Regra[]): Regra[] {
  return [...regras].sort(
    (a, b) =>
      Number(b.ativa) - Number(a.ativa) ||
      especificidade_regra(b) - especificidade_regra(a) ||
      a.dataCriacao.getTime() - b.dataCriacao.getTime(),
  );
}
