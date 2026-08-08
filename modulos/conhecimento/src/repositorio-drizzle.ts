import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  auditoria as auditoriaTabela,
  categoria as categoriaTabela,
  movimento as movimentoTabela,
  obter_banco,
  pessoa as pessoaTabela,
  regra as regraTabela,
} from "@lancai/banco";
import type { Movimento, NovaRegra, Regra } from "@lancai/banco";
import type { OperacaoConhecimento, RepositorioConhecimento } from "./repositorio";

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

  async obterPessoa(id: string): Promise<{ id: string } | undefined> {
    const linhas = await this.banco
      .select({ id: pessoaTabela.id })
      .from(pessoaTabela)
      .where(eq(pessoaTabela.id, id))
      .limit(1);
    return linhas[0];
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

  async listarRegrasAtivas(workspaceId: string): Promise<Regra[]> {
    /**
     * Trecho maior primeiro: "IFOOD *LOOP" ganha de "IFOOD". Empate pela
     * regra mais antiga — a que o usuário ensinou primeiro.
     */
    return this.banco
      .select()
      .from(regraTabela)
      .where(and(eq(regraTabela.workspaceId, workspaceId), eq(regraTabela.ativa, true)))
      .orderBy(desc(sql`char_length(${regraTabela.condicaoValor})`), asc(regraTabela.dataCriacao));
  }

  async listarRegras(workspaceId: string): Promise<Regra[]> {
    return this.banco
      .select()
      .from(regraTabela)
      .where(eq(regraTabela.workspaceId, workspaceId))
      .orderBy(
        desc(regraTabela.ativa),
        desc(sql`char_length(${regraTabela.condicaoValor})`),
        asc(regraTabela.dataCriacao),
      );
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

  async atualizarRegra(id: string, campos: { ativa: boolean }): Promise<Regra | undefined> {
    const [atualizada] = await this.banco
      .update(regraTabela)
      .set({ ativa: campos.ativa, dataAtualizacao: new Date() })
      .where(eq(regraTabela.id, id))
      .returning();
    return atualizada;
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
