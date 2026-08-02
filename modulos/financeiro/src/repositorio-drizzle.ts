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
  OperacaoCorrecao,
  OperacaoPersistencia,
  RepositorioFinanceiro,
  ResultadoOperacaoPersistencia,
} from "./repositorio";
import type { Movimento } from "@lancai/banco";

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

  async listarParcelasDoMovimento(movimentoId: string) {
    return this.banco
      .select()
      .from(parcelaTabela)
      .where(and(eq(parcelaTabela.movimentoId, movimentoId), ne(parcelaTabela.status, "cancelado")));
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

  async corrigirMovimento(operacao: OperacaoCorrecao): Promise<Movimento> {
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

      for (const atualizacaoSaldo of operacao.atualizacoesSaldoConta) {
        await tx
          .update(contaTabela)
          .set({ saldoAtual: String(atualizacaoSaldo.saldoAtual), dataAtualizacao: new Date() })
          .where(eq(contaTabela.id, atualizacaoSaldo.contaId));
      }

      if (operacao.regenerarParcelas) {
        await tx
          .update(parcelaTabela)
          .set({ status: "cancelado", dataAtualizacao: new Date() })
          .where(
            and(eq(parcelaTabela.movimentoId, operacao.movimentoId), ne(parcelaTabela.status, "cancelado")),
          );
        if (operacao.regenerarParcelas.novasParcelas.length > 0) {
          await tx.insert(parcelaTabela).values(operacao.regenerarParcelas.novasParcelas);
        }
      }

      await tx.insert(auditoriaTabela).values(operacao.auditoria);

      return atualizado;
    });
  }
}
