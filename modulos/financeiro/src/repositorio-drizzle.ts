import { and, eq, ne } from "drizzle-orm";
import {
  auditoria as auditoriaTabela,
  cartao as cartaoTabela,
  categoria as categoriaTabela,
  conta as contaTabela,
  movimento as movimentoTabela,
  obter_banco,
  parcela as parcelaTabela,
  pessoa as pessoaTabela,
} from "@lancai/banco";
import type {
  OperacaoPersistencia,
  RepositorioFinanceiro,
  ResultadoOperacaoPersistencia,
} from "./repositorio";
import type { Movimento, NovaAuditoria, NovoMovimento } from "@lancai/banco";

/** Implementação real do RepositorioFinanceiro, sobre Supabase Postgres via Drizzle. */
export class RepositorioFinanceiroDrizzle implements RepositorioFinanceiro {
  private get banco() {
    return obter_banco();
  }

  async obterConta(id: string) {
    const [linha] = await this.banco.select().from(contaTabela).where(eq(contaTabela.id, id)).limit(1);
    return linha;
  }

  async obterCartao(id: string) {
    const [linha] = await this.banco.select().from(cartaoTabela).where(eq(cartaoTabela.id, id)).limit(1);
    return linha;
  }

  async obterCategoria(id: string) {
    const [linha] = await this.banco
      .select()
      .from(categoriaTabela)
      .where(eq(categoriaTabela.id, id))
      .limit(1);
    return linha;
  }

  async obterPessoa(id: string) {
    const [linha] = await this.banco.select().from(pessoaTabela).where(eq(pessoaTabela.id, id)).limit(1);
    return linha;
  }

  async obterMovimento(id: string) {
    const [linha] = await this.banco
      .select()
      .from(movimentoTabela)
      .where(eq(movimentoTabela.id, id))
      .limit(1);
    return linha;
  }

  async obterTotalComprometidoCartao(cartaoId: string) {
    const linhas = await this.banco
      .select({ valor: parcelaTabela.valor })
      .from(parcelaTabela)
      .innerJoin(movimentoTabela, eq(parcelaTabela.movimentoId, movimentoTabela.id))
      .where(and(eq(movimentoTabela.cartaoId, cartaoId), ne(parcelaTabela.status, "cancelado")));

    const total = linhas.reduce((acumulado, linha) => acumulado + Number.parseFloat(linha.valor), 0);
    return Math.round(total * 100) / 100;
  }

  async persistirOperacao(operacao: OperacaoPersistencia): Promise<ResultadoOperacaoPersistencia> {
    return this.banco.transaction(async (tx) => {
      const movimentosCriados = operacao.movimentos.length
        ? await tx.insert(movimentoTabela).values(operacao.movimentos).returning()
        : [];

      const parcelasCriadas = operacao.parcelas.length
        ? await tx.insert(parcelaTabela).values(operacao.parcelas).returning()
        : [];

      for (const atualizacao of operacao.atualizacoesSaldoConta) {
        await tx
          .update(contaTabela)
          .set({ saldoAtual: String(atualizacao.saldoAtual), dataAtualizacao: new Date() })
          .where(eq(contaTabela.id, atualizacao.contaId));
      }

      if (operacao.auditorias.length) {
        await tx.insert(auditoriaTabela).values(operacao.auditorias);
      }

      return { movimentos: movimentosCriados, parcelas: parcelasCriadas };
    });
  }

  async atualizarMovimento(
    id: string,
    campos: Partial<NovoMovimento>,
    auditoria: NovaAuditoria,
  ): Promise<Movimento> {
    return this.banco.transaction(async (tx) => {
      const linhasAtualizadas = await tx
        .update(movimentoTabela)
        .set({ ...campos, dataAtualizacao: new Date() })
        .where(eq(movimentoTabela.id, id))
        .returning();

      const atualizado = linhasAtualizadas[0];
      if (!atualizado) {
        throw new Error(`Movimento não encontrado para atualização: ${id}`);
      }

      await tx.insert(auditoriaTabela).values(auditoria);

      return atualizado;
    });
  }
}
