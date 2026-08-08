import { randomUUID } from "node:crypto";
import type { Auditoria, Cartao, Categoria, Conta, Movimento, Parcela, Pessoa } from "@lancai/banco";
import type {
  OperacaoAtualizacaoFonte,
  OperacaoCorrecao,
  OperacaoPersistencia,
  RepositorioFinanceiro,
  ResultadoOperacaoPersistencia,
} from "./repositorio";

/**
 * Implementação em memória do RepositorioFinanceiro, usada exclusivamente
 * nos testes unitários do MotorFinanceiro (sem dependência de Postgres).
 */
export class RepositorioFinanceiroMemoria implements RepositorioFinanceiro {
  readonly contas = new Map<string, Conta>();
  readonly cartoes = new Map<string, Cartao>();
  readonly categorias = new Map<string, Categoria>();
  readonly pessoas = new Map<string, Pessoa>();
  readonly movimentos = new Map<string, Movimento>();
  readonly parcelas = new Map<string, Parcela>();
  readonly auditorias: Auditoria[] = [];

  async obterConta(id: string) {
    return this.contas.get(id);
  }

  async obterCartao(id: string) {
    return this.cartoes.get(id);
  }

  async obterCategoria(id: string) {
    return this.categorias.get(id);
  }

  async obterPessoa(id: string) {
    return this.pessoas.get(id);
  }

  async obterMovimento(id: string) {
    return this.movimentos.get(id);
  }

  async obterMovimentoPorIdExterno(chave: {
    workspaceId: string;
    fonte: string;
    provedor?: string;
    idExterno: string;
  }) {
    return [...this.movimentos.values()].find(
      (movimento) =>
        movimento.workspaceId === chave.workspaceId &&
        movimento.fonte === chave.fonte &&
        (movimento.provedor ?? undefined) === chave.provedor &&
        movimento.idExterno === chave.idExterno,
    );
  }

  async listarParcelasDoMovimento(movimentoId: string) {
    return [...this.parcelas.values()].filter(
      (parcela) => parcela.movimentoId === movimentoId && parcela.status !== "cancelado",
    );
  }

  async obterTotalComprometidoCartao(cartaoId: string) {
    let total = 0;
    for (const movimento of this.movimentos.values()) {
      if (movimento.cartaoId !== cartaoId) continue;
      for (const parcela of this.parcelas.values()) {
        if (parcela.movimentoId !== movimento.id) continue;
        if (parcela.status === "cancelado") continue;
        total += Number.parseFloat(parcela.valor);
      }
    }
    return Math.round(total * 100) / 100;
  }

  async persistirOperacao(operacao: OperacaoPersistencia): Promise<ResultadoOperacaoPersistencia> {
    const movimentosCriados: Movimento[] = [];

    for (const novoMovimento of operacao.movimentos) {
      const agora = new Date();
      const movimento: Movimento = {
        id: novoMovimento.id ?? randomUUID(),
        workspaceId: novoMovimento.workspaceId,
        fonte: novoMovimento.fonte ?? "manual",
        provedor: novoMovimento.provedor ?? null,
        idExterno: novoMovimento.idExterno ?? null,
        descricaoFonte: novoMovimento.descricaoFonte,
        favorecidoFonte: novoMovimento.favorecidoFonte ?? null,
        statusFonte: novoMovimento.statusFonte ?? "confirmado",
        parcelaNumero: novoMovimento.parcelaNumero ?? null,
        parcelaTotal: novoMovimento.parcelaTotal ?? null,
        parcelaCompraEm: novoMovimento.parcelaCompraEm ?? null,
        parcelaCompraValor: novoMovimento.parcelaCompraValor ?? null,
        descricao: novoMovimento.descricao,
        valor: String(novoMovimento.valor),
        tipo: novoMovimento.tipo,
        status: novoMovimento.status ?? "realizado",
        perfil: novoMovimento.perfil,
        formaPagamento: novoMovimento.formaPagamento ?? null,
        dataMovimento: novoMovimento.dataMovimento,
        dataLancamento: novoMovimento.dataLancamento ?? agora,
        contaId: novoMovimento.contaId ?? null,
        cartaoId: novoMovimento.cartaoId ?? null,
        categoriaId: novoMovimento.categoriaId,
        pessoaId: novoMovimento.pessoaId ?? null,
        tags: novoMovimento.tags ?? [],
        observacoes: novoMovimento.observacoes ?? null,
        classificadoPor: novoMovimento.classificadoPor ?? "usuario",
        regraId: novoMovimento.regraId ?? null,
        classificadoEm: novoMovimento.classificadoEm ?? null,
        confiancaIa: novoMovimento.confiancaIa ?? null,
        ignoradoEmRelatorio: novoMovimento.ignoradoEmRelatorio ?? false,
        usuarioId: novoMovimento.usuarioId,
        dataCriacao: agora,
        dataAtualizacao: agora,
        criadoPor: novoMovimento.criadoPor,
        alteradoPor: novoMovimento.alteradoPor ?? null,
      };
      this.movimentos.set(movimento.id, movimento);
      movimentosCriados.push(movimento);
    }

    const parcelasCriadas: Parcela[] = [];
    for (const novaParcela of operacao.parcelas) {
      const agora = new Date();
      const parcela: Parcela = {
        id: novaParcela.id ?? randomUUID(),
        movimentoId: novaParcela.movimentoId,
        numeroParcela: novaParcela.numeroParcela,
        valor: String(novaParcela.valor),
        dataMovimento: novaParcela.dataMovimento,
        status: novaParcela.status ?? "previsto",
        dataCriacao: agora,
        dataAtualizacao: agora,
      };
      this.parcelas.set(parcela.id, parcela);
      parcelasCriadas.push(parcela);
    }

    for (const atualizacao of operacao.atualizacoesSaldoConta) {
      const conta = this.contas.get(atualizacao.contaId);
      if (!conta) continue;
      this.contas.set(atualizacao.contaId, {
        ...conta,
        saldoAtual: String(atualizacao.saldoAtual),
        dataAtualizacao: new Date(),
      });
    }

    for (const novaAuditoria of operacao.auditorias) {
      this.auditorias.push({
        id: randomUUID(),
        tabela: novaAuditoria.tabela,
        registroId: novaAuditoria.registroId,
        acao: novaAuditoria.acao,
        estadoAnterior: novaAuditoria.estadoAnterior ?? null,
        estadoAtual: novaAuditoria.estadoAtual ?? null,
        alteradoPor: novaAuditoria.alteradoPor,
        dataCriacao: new Date(),
      });
    }

    return { movimentos: movimentosCriados, parcelas: parcelasCriadas };
  }

  async corrigirMovimento(operacao: OperacaoCorrecao) {
    const existente = this.movimentos.get(operacao.movimentoId);
    if (!existente) {
      throw new Error(`Movimento não encontrado: ${operacao.movimentoId}`);
    }

    const atualizado: Movimento = {
      ...existente,
      ...operacao.campos,
      valor: operacao.campos.valor !== undefined ? String(operacao.campos.valor) : existente.valor,
      dataAtualizacao: new Date(),
    } as Movimento;
    this.movimentos.set(operacao.movimentoId, atualizado);

    for (const atualizacao of operacao.atualizacoesSaldoConta) {
      const conta = this.contas.get(atualizacao.contaId);
      if (!conta) continue;
      this.contas.set(atualizacao.contaId, {
        ...conta,
        saldoAtual: String(atualizacao.saldoAtual),
        dataAtualizacao: new Date(),
      });
    }

    if (operacao.regenerarParcelas) {
      for (const [id, parcela] of this.parcelas.entries()) {
        if (parcela.movimentoId !== operacao.movimentoId || parcela.status === "cancelado") continue;
        this.parcelas.set(id, { ...parcela, status: "cancelado", dataAtualizacao: new Date() });
      }
      for (const novaParcela of operacao.regenerarParcelas.novasParcelas) {
        const agora = new Date();
        const parcela: Parcela = {
          id: novaParcela.id ?? randomUUID(),
          movimentoId: novaParcela.movimentoId,
          numeroParcela: novaParcela.numeroParcela,
          valor: String(novaParcela.valor),
          dataMovimento: novaParcela.dataMovimento,
          status: novaParcela.status ?? "previsto",
          dataCriacao: agora,
          dataAtualizacao: agora,
        };
        this.parcelas.set(parcela.id, parcela);
      }
    }

    this.auditorias.push({
      id: randomUUID(),
      tabela: operacao.auditoria.tabela,
      registroId: operacao.auditoria.registroId,
      acao: operacao.auditoria.acao,
      estadoAnterior: operacao.auditoria.estadoAnterior ?? null,
      estadoAtual: operacao.auditoria.estadoAtual ?? null,
      alteradoPor: operacao.auditoria.alteradoPor,
      dataCriacao: new Date(),
    });

    return atualizado;
  }

  async atualizarFatosDaFonte(operacao: OperacaoAtualizacaoFonte): Promise<Movimento[]> {
    const atualizados: Movimento[] = [];

    for (const atualizacao of operacao.atualizacoes) {
      const existente = this.movimentos.get(atualizacao.movimentoId);
      if (!existente) {
        throw new Error(`Movimento não encontrado: ${atualizacao.movimentoId}`);
      }

      const atualizado = {
        ...existente,
        ...atualizacao.campos,
        dataAtualizacao: new Date(),
      } as Movimento;
      this.movimentos.set(atualizacao.movimentoId, atualizado);
      atualizados.push(atualizado);
    }

    for (const atualizacao of operacao.atualizacoesSaldoConta) {
      const conta = this.contas.get(atualizacao.contaId);
      if (!conta) continue;
      this.contas.set(atualizacao.contaId, {
        ...conta,
        saldoAtual: String(atualizacao.saldoAtual),
        dataAtualizacao: new Date(),
      });
    }

    for (const auditoria of operacao.auditorias) {
      this.auditorias.push({
        id: randomUUID(),
        tabela: auditoria.tabela,
        registroId: auditoria.registroId,
        acao: auditoria.acao,
        estadoAnterior: auditoria.estadoAnterior ?? null,
        estadoAtual: auditoria.estadoAtual ?? null,
        alteradoPor: auditoria.alteradoPor,
        dataCriacao: new Date(),
      });
    }

    return atualizados;
  }

  async definirSincronizacaoConta(contaId: string, sincronizada: boolean): Promise<void> {
    const conta = this.contas.get(contaId);
    if (!conta) return;
    this.contas.set(contaId, { ...conta, sincronizada, dataAtualizacao: new Date() });
  }

  async definirSincronizacaoCartao(cartaoId: string, sincronizada: boolean): Promise<void> {
    const cartao = this.cartoes.get(cartaoId);
    if (!cartao) return;
    this.cartoes.set(cartaoId, { ...cartao, sincronizada, dataAtualizacao: new Date() });
  }
}
