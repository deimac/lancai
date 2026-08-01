import { randomUUID } from "node:crypto";
import type {
  Auditoria,
  Cartao,
  Categoria,
  Conta,
  Movimento,
  NovoMovimento,
  Parcela,
  Pessoa,
} from "@lancai/banco";
import type { OperacaoPersistencia, RepositorioFinanceiro, ResultadoOperacaoPersistencia } from "./repositorio";

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
        descricao: novoMovimento.descricao,
        valor: String(novoMovimento.valor),
        tipo: novoMovimento.tipo,
        status: novoMovimento.status ?? "realizado",
        perfil: novoMovimento.perfil,
        dataMovimento: novoMovimento.dataMovimento,
        dataLancamento: novoMovimento.dataLancamento ?? agora,
        contaId: novoMovimento.contaId ?? null,
        cartaoId: novoMovimento.cartaoId ?? null,
        categoriaId: novoMovimento.categoriaId,
        pessoaId: novoMovimento.pessoaId ?? null,
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

  async atualizarMovimento(id: string, campos: Partial<NovoMovimento>, auditoria: { estadoAnterior?: unknown; estadoAtual?: unknown; alteradoPor: string }) {
    const existente = this.movimentos.get(id);
    if (!existente) {
      throw new Error(`Movimento não encontrado: ${id}`);
    }
    const atualizado: Movimento = {
      ...existente,
      ...campos,
      valor: campos.valor !== undefined ? String(campos.valor) : existente.valor,
      dataAtualizacao: new Date(),
      alteradoPor: auditoria.alteradoPor,
    } as Movimento;
    this.movimentos.set(id, atualizado);

    this.auditorias.push({
      id: randomUUID(),
      tabela: "movimento",
      registroId: id,
      acao: "ALTERACAO",
      estadoAnterior: (auditoria.estadoAnterior as never) ?? null,
      estadoAtual: (auditoria.estadoAtual as never) ?? null,
      alteradoPor: auditoria.alteradoPor,
      dataCriacao: new Date(),
    });

    return atualizado;
  }
}
