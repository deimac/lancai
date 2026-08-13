import { and, eq, isNull, ne, sql } from "drizzle-orm";
import {
  auditoria as auditoriaTabela,
  cartao as cartaoTabela,
  categoria as categoriaTabela,
  conta as contaTabela,
  contaFinanceira as contaFinanceiraTabela,
  movimento as movimentoTabela,
  obter_banco,
  parcela as parcelaTabela,
  pessoa as pessoaTabela,
} from "@lancai/banco";
import type {
  OperacaoAtualizacaoFonte,
  OperacaoCorrecao,
  OperacaoPersistencia,
  RepositorioFinanceiro,
  ResultadoOperacaoPersistencia,
} from "./repositorio";
import type { Cartao, Conta, Movimento } from "@lancai/banco";

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

  async obterMovimentoPorIdExterno(chave: {
    workspaceId: string;
    fonte: string;
    provedor?: string;
    idExterno: string;
  }): Promise<Movimento | undefined> {
    const [linha] = await this.banco
      .select()
      .from(movimentoTabela)
      .where(
        and(
          eq(movimentoTabela.workspaceId, chave.workspaceId),
          eq(movimentoTabela.fonte, chave.fonte as Movimento["fonte"]),
          chave.provedor === undefined
            ? isNull(movimentoTabela.provedor)
            : eq(movimentoTabela.provedor, chave.provedor),
          eq(movimentoTabela.idExterno, chave.idExterno),
        ),
      )
      .limit(1);
    return linha;
  }

  async listarMovimentosPorFingerprint(chave: {
    workspaceId: string;
    fonte: string;
    provedor?: string;
    fingerprint: string;
  }): Promise<Movimento[]> {
    return this.banco
      .select()
      .from(movimentoTabela)
      .where(
        and(
          eq(movimentoTabela.workspaceId, chave.workspaceId),
          eq(movimentoTabela.fonte, chave.fonte as Movimento["fonte"]),
          chave.provedor === undefined
            ? isNull(movimentoTabela.provedor)
            : eq(movimentoTabela.provedor, chave.provedor),
          eq(movimentoTabela.fingerprint, chave.fingerprint),
        ),
      );
  }

  async listarMovimentosParceladosDoCartao(cartaoId: string): Promise<Movimento[]> {
    return this.banco
      .select()
      .from(movimentoTabela)
      .where(
        and(
          eq(movimentoTabela.cartaoId, cartaoId),
          sql`${movimentoTabela.parcelaTotal} is not null`,
          sql`${movimentoTabela.parcelaTotal} >= 2`,
          ne(movimentoTabela.status, "cancelado"),
        ),
      );
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

  async atualizarFatosDaFonte(operacao: OperacaoAtualizacaoFonte): Promise<Movimento[]> {
    return this.banco.transaction(async (tx) => {
      /**
       * A única declaração desta permissão no sistema. `LOCAL` a amarra a esta
       * transação: se algo falhar no meio, some junto com o rollback, e nenhuma
       * escrita posterior na mesma conexão a herda.
       */
      await tx.execute(sql`SET LOCAL "lancai.sincronizacao" = 'on'`);

      const atualizados: Movimento[] = [];

      for (const atualizacao of operacao.atualizacoes) {
        const [linha] = await tx
          .update(movimentoTabela)
          .set({ ...atualizacao.campos, dataAtualizacao: new Date() })
          .where(eq(movimentoTabela.id, atualizacao.movimentoId))
          .returning();

        if (!linha) {
          throw new Error(`Movimento não encontrado para atualização: ${atualizacao.movimentoId}`);
        }
        atualizados.push(linha);
      }

      for (const atualizacaoSaldo of operacao.atualizacoesSaldoConta) {
        await tx
          .update(contaTabela)
          .set({ saldoAtual: String(atualizacaoSaldo.saldoAtual), dataAtualizacao: new Date() })
          .where(eq(contaTabela.id, atualizacaoSaldo.contaId));
      }

      if (operacao.auditorias.length > 0) {
        await tx.insert(auditoriaTabela).values(operacao.auditorias);
      }

      return atualizados;
    });
  }

  async definirSincronizacaoConta(contaId: string, sincronizada: boolean): Promise<void> {
    await this.banco
      .update(contaTabela)
      .set({ sincronizada, dataAtualizacao: new Date() })
      .where(eq(contaTabela.id, contaId));
  }

  async definirSincronizacaoCartao(cartaoId: string, sincronizada: boolean): Promise<void> {
    await this.banco
      .update(cartaoTabela)
      .set({ sincronizada, dataAtualizacao: new Date() })
      .where(eq(cartaoTabela.id, cartaoId));
  }

  async criarContaSincronizada(entrada: {
    workspaceId: string;
    usuarioId: string;
    nome: string;
    perfil: Conta["perfil"];
    saldoAtual?: number;
    conexaoId?: string | null;
  }) {
    const saldo = String(entrada.saldoAtual ?? 0);
    const [identidade] = await this.banco
      .insert(contaFinanceiraTabela)
      .values({
        usuarioId: entrada.usuarioId,
        instituicao: entrada.nome,
        nomeExibicao: entrada.nome,
        tipo: "conta_corrente",
        perfil: entrada.perfil,
        origem: "open_finance",
        conexaoStatus: "conectado",
        conexaoId: entrada.conexaoId ?? null,
      })
      .returning();
    if (!identidade) throw new Error("Falha ao criar identidade da conta sincronizada.");

    const [criada] = await this.banco
      .insert(contaTabela)
      .values({
        workspaceId: entrada.workspaceId,
        usuarioId: entrada.usuarioId,
        nome: entrada.nome,
        perfil: entrada.perfil,
        saldoInicial: saldo,
        saldoAtual: saldo,
        sincronizada: true,
        contaFinanceiraId: identidade.id,
      })
      .returning();
    if (!criada) throw new Error("Falha ao criar conta sincronizada.");
    return criada;
  }

  async criarCartaoSincronizado(entrada: {
    workspaceId: string;
    usuarioId: string;
    nome: string;
    perfil: Cartao["perfil"];
    saldo?: number;
    limite?: number;
    fechamento?: number;
    vencimento?: number;
    conexaoId?: string | null;
  }) {
    const fechamento = entrada.fechamento ?? 1;
    const vencimento = entrada.vencimento ?? 10;
    const [identidade] = await this.banco
      .insert(contaFinanceiraTabela)
      .values({
        usuarioId: entrada.usuarioId,
        instituicao: entrada.nome,
        nomeExibicao: entrada.nome,
        tipo: "credito",
        perfil: entrada.perfil,
        origem: "open_finance",
        conexaoStatus: "conectado",
        conexaoId: entrada.conexaoId ?? null,
      })
      .returning();
    if (!identidade) throw new Error("Falha ao criar identidade do cartão sincronizado.");

    const [criado] = await this.banco
      .insert(cartaoTabela)
      .values({
        workspaceId: entrada.workspaceId,
        usuarioId: entrada.usuarioId,
        nome: entrada.nome,
        perfil: entrada.perfil,
        limite: String(entrada.limite ?? 0),
        saldo: String(entrada.saldo ?? 0),
        fechamento,
        vencimento,
        melhorDiaCompra: fechamento === 31 ? 1 : fechamento + 1,
        modalidade: "credito",
        sincronizada: true,
        contaFinanceiraId: identidade.id,
      })
      .returning();
    if (!criado) throw new Error("Falha ao criar cartão sincronizado.");
    return criado;
  }

  async atualizarDadosInstitucionaisCartao(
    cartaoId: string,
    dados: {
      nome?: string;
      saldo?: number;
      limite?: number;
      fechamento?: number;
      vencimento?: number;
    },
  ): Promise<void> {
    const patch: {
      nome?: string;
      saldo?: string;
      limite?: string;
      fechamento?: number;
      vencimento?: number;
      melhorDiaCompra?: number;
      dataAtualizacao: Date;
    } = { dataAtualizacao: new Date() };
    const nome = dados.nome?.trim();
    if (nome) patch.nome = nome;
    if (typeof dados.saldo === "number" && Number.isFinite(dados.saldo)) {
      patch.saldo = String(dados.saldo);
    }
    if (typeof dados.limite === "number" && Number.isFinite(dados.limite)) {
      patch.limite = String(dados.limite);
    }
    if (typeof dados.fechamento === "number" && dados.fechamento >= 1 && dados.fechamento <= 31) {
      patch.fechamento = dados.fechamento;
      patch.melhorDiaCompra = dados.fechamento === 31 ? 1 : dados.fechamento + 1;
    }
    if (typeof dados.vencimento === "number" && dados.vencimento >= 1 && dados.vencimento <= 31) {
      patch.vencimento = dados.vencimento;
    }
    await this.banco.update(cartaoTabela).set(patch).where(eq(cartaoTabela.id, cartaoId));
  }

  async atualizarDadosInstitucionaisConta(
    contaId: string,
    dados: { saldoAtual?: number; nome?: string },
  ): Promise<void> {
    const patch: { saldoAtual?: string; nome?: string; dataAtualizacao: Date } = {
      dataAtualizacao: new Date(),
    };
    const nome = dados.nome?.trim();
    if (nome) patch.nome = nome;
    if (typeof dados.saldoAtual === "number" && Number.isFinite(dados.saldoAtual)) {
      patch.saldoAtual = String(dados.saldoAtual);
    }
    if (patch.nome === undefined && patch.saldoAtual === undefined) return;
    await this.banco.update(contaTabela).set(patch).where(eq(contaTabela.id, contaId));
  }

  async definirConexaoIdentidade(
    destino: { contaId?: string; cartaoId?: string },
    conexaoId: string,
  ): Promise<void> {
    let identidadeId: string | null = null;
    if (destino.contaId) {
      const conta = await this.obterConta(destino.contaId);
      identidadeId = conta?.contaFinanceiraId ?? null;
    } else if (destino.cartaoId) {
      const cartao = await this.obterCartao(destino.cartaoId);
      identidadeId = cartao?.contaFinanceiraId ?? null;
    }
    if (!identidadeId) return;
    await this.banco
      .update(contaFinanceiraTabela)
      .set({
        conexaoId,
        conexaoStatus: "conectado",
        dataAtualizacao: new Date(),
      })
      .where(eq(contaFinanceiraTabela.id, identidadeId));
  }
}
