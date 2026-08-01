import { randomUUID } from "node:crypto";
import { arredondar, deISOParaData, paraColuna, paraNumero, schemaCriarMovimento } from "@lancai/tipos";
import type { EntradaCriarMovimento } from "@lancai/tipos";
import type { NovaAuditoria, NovaParcela, NovoMovimento } from "@lancai/banco";
import { calcular_saldo, tipo_movimento_implementado } from "./calcular-saldo";
import { registrar_parcelamento } from "./registrar-parcelamento";
import {
  ErroLimiteCartaoExcedido,
  ErroRecursoNaoEncontrado,
  ErroTipoMovimentoNaoImplementado,
  ErroValidacaoFinanceira,
} from "./erros";
import type { RepositorioFinanceiro, ResultadoOperacaoPersistencia } from "./repositorio";

export type ResultadoCriarMovimento = ResultadoOperacaoPersistencia;

/**
 * Coração do sistema: valida informações, aplica regras, cria lançamentos,
 * recalcula saldos, gera parcelas e aciona a auditoria. É o único componente
 * com autoridade para alterar o estado financeiro do usuário (ADR-002).
 *
 * A IA nunca chama o banco diretamente — ela só monta a `EntradaCriarMovimento`
 * que é passada para `criar_movimento`.
 */
export class MotorFinanceiro {
  constructor(private readonly repositorio: RepositorioFinanceiro) {}

  async criar_movimento(entradaBruta: EntradaCriarMovimento): Promise<ResultadoCriarMovimento> {
    const entrada = schemaCriarMovimento.parse(entradaBruta);

    const categoria = await this.repositorio.obterCategoria(entrada.categoriaId);
    if (!categoria) {
      throw new ErroRecursoNaoEncontrado("categoria", entrada.categoriaId);
    }

    if (entrada.pessoaId) {
      const pessoa = await this.repositorio.obterPessoa(entrada.pessoaId);
      if (!pessoa) {
        throw new ErroRecursoNaoEncontrado("pessoa", entrada.pessoaId);
      }
    }

    if (entrada.tipo === "transferencia") {
      return this.criar_transferencia(entrada);
    }

    if (entrada.cartaoId) {
      return this.criar_movimento_em_cartao(entrada);
    }

    return this.criar_movimento_em_conta(entrada);
  }

  private async criar_movimento_em_conta(entrada: EntradaCriarMovimento): Promise<ResultadoCriarMovimento> {
    if (!tipo_movimento_implementado(entrada.tipo)) {
      throw new ErroTipoMovimentoNaoImplementado(entrada.tipo);
    }

    const conta = await this.repositorio.obterConta(entrada.contaId as string);
    if (!conta) {
      throw new ErroRecursoNaoEncontrado("conta", entrada.contaId as string);
    }
    if (!conta.ativo) {
      throw new ErroValidacaoFinanceira(`Conta "${conta.nome}" está inativa.`);
    }

    const movimentoId = randomUUID();
    const novoMovimento: NovoMovimento = {
      id: movimentoId,
      descricao: entrada.descricao,
      valor: paraColuna(entrada.valor),
      tipo: entrada.tipo,
      status: entrada.status,
      perfil: entrada.perfil,
      dataMovimento: entrada.dataMovimento,
      contaId: conta.id,
      categoriaId: entrada.categoriaId,
      pessoaId: entrada.pessoaId,
      usuarioId: entrada.usuarioId,
      criadoPor: entrada.criadoPor,
    };

    const atualizacoesSaldoConta = [];
    if (entrada.status === "realizado") {
      const saldoNovo = calcular_saldo(paraNumero(conta.saldoAtual), entrada.tipo, entrada.valor);
      atualizacoesSaldoConta.push({ contaId: conta.id, saldoAtual: saldoNovo });
    }

    const auditoria: NovaAuditoria = {
      tabela: "movimento",
      registroId: movimentoId,
      acao: "INSERCAO",
      estadoAnterior: null,
      estadoAtual: novoMovimento,
      alteradoPor: entrada.criadoPor,
    };

    return this.repositorio.persistirOperacao({
      movimentos: [novoMovimento],
      parcelas: [],
      atualizacoesSaldoConta,
      auditorias: [auditoria],
    });
  }

  /**
   * Transferência sempre gera duas linhas de `movimento` (débito na origem,
   * crédito no destino) na mesma operação atômica — não existe uma coluna
   * própria de "conta destino" no schema, então cada ponta é auto-suficiente
   * para o cálculo de saldo da sua respectiva conta.
   */
  private async criar_transferencia(entrada: EntradaCriarMovimento): Promise<ResultadoCriarMovimento> {
    const contaOrigem = await this.repositorio.obterConta(entrada.contaId as string);
    if (!contaOrigem) {
      throw new ErroRecursoNaoEncontrado("conta", entrada.contaId as string);
    }
    const contaDestino = await this.repositorio.obterConta(entrada.contaDestinoId as string);
    if (!contaDestino) {
      throw new ErroRecursoNaoEncontrado("conta", entrada.contaDestinoId as string);
    }
    if (contaOrigem.id === contaDestino.id) {
      throw new ErroValidacaoFinanceira("Conta de origem e destino não podem ser a mesma.");
    }

    const idOrigem = randomUUID();
    const idDestino = randomUUID();

    const movimentoOrigem: NovoMovimento = {
      id: idOrigem,
      descricao: `${entrada.descricao} (enviado para ${contaDestino.nome})`,
      valor: paraColuna(entrada.valor),
      tipo: "transferencia",
      status: entrada.status,
      perfil: entrada.perfil,
      dataMovimento: entrada.dataMovimento,
      contaId: contaOrigem.id,
      categoriaId: entrada.categoriaId,
      pessoaId: entrada.pessoaId,
      usuarioId: entrada.usuarioId,
      criadoPor: entrada.criadoPor,
    };

    const movimentoDestino: NovoMovimento = {
      id: idDestino,
      descricao: `${entrada.descricao} (recebido de ${contaOrigem.nome})`,
      valor: paraColuna(entrada.valor),
      tipo: "transferencia",
      status: entrada.status,
      perfil: entrada.perfil,
      dataMovimento: entrada.dataMovimento,
      contaId: contaDestino.id,
      categoriaId: entrada.categoriaId,
      pessoaId: entrada.pessoaId,
      usuarioId: entrada.usuarioId,
      criadoPor: entrada.criadoPor,
    };

    const atualizacoesSaldoConta: Array<{ contaId: string; saldoAtual: number }> = [];
    if (entrada.status === "realizado") {
      atualizacoesSaldoConta.push(
        {
          contaId: contaOrigem.id,
          saldoAtual: calcular_saldo(paraNumero(contaOrigem.saldoAtual), "transferencia", entrada.valor, "origem"),
        },
        {
          contaId: contaDestino.id,
          saldoAtual: calcular_saldo(
            paraNumero(contaDestino.saldoAtual),
            "transferencia",
            entrada.valor,
            "destino",
          ),
        },
      );
    }

    const auditorias: NovaAuditoria[] = [
      {
        tabela: "movimento",
        registroId: idOrigem,
        acao: "INSERCAO",
        estadoAnterior: null,
        estadoAtual: movimentoOrigem,
        alteradoPor: entrada.criadoPor,
      },
      {
        tabela: "movimento",
        registroId: idDestino,
        acao: "INSERCAO",
        estadoAnterior: null,
        estadoAtual: movimentoDestino,
        alteradoPor: entrada.criadoPor,
      },
    ];

    return this.repositorio.persistirOperacao({
      movimentos: [movimentoOrigem, movimentoDestino],
      parcelas: [],
      atualizacoesSaldoConta,
      auditorias,
    });
  }

  private async criar_movimento_em_cartao(entrada: EntradaCriarMovimento): Promise<ResultadoCriarMovimento> {
    if (!tipo_movimento_implementado(entrada.tipo)) {
      throw new ErroTipoMovimentoNaoImplementado(entrada.tipo);
    }

    const cartao = await this.repositorio.obterCartao(entrada.cartaoId as string);
    if (!cartao) {
      throw new ErroRecursoNaoEncontrado("cartao", entrada.cartaoId as string);
    }
    if (!cartao.ativo) {
      throw new ErroValidacaoFinanceira(`Cartão "${cartao.nome}" está inativo.`);
    }

    const quantidadeParcelas = entrada.parcelamento?.quantidadeParcelas ?? 1;

    const comprometidoAtual = await this.repositorio.obterTotalComprometidoCartao(cartao.id);
    const limite = paraNumero(cartao.limite);
    if (arredondar(comprometidoAtual + entrada.valor) > limite) {
      throw new ErroLimiteCartaoExcedido(cartao.nome, arredondar(limite - comprometidoAtual), entrada.valor);
    }

    const movimentoId = randomUUID();
    const novoMovimento: NovoMovimento = {
      id: movimentoId,
      descricao: entrada.descricao,
      valor: paraColuna(entrada.valor),
      tipo: entrada.tipo,
      status: entrada.status,
      perfil: entrada.perfil,
      dataMovimento: entrada.dataMovimento,
      cartaoId: cartao.id,
      categoriaId: entrada.categoriaId,
      pessoaId: entrada.pessoaId,
      usuarioId: entrada.usuarioId,
      criadoPor: entrada.criadoPor,
    };

    const parcelasCalculadas = registrar_parcelamento(
      entrada.valor,
      quantidadeParcelas,
      deISOParaData(entrada.dataMovimento),
      cartao,
    );

    const novasParcelas: NovaParcela[] = parcelasCalculadas.map((parcela) => ({
      id: randomUUID(),
      movimentoId,
      numeroParcela: parcela.numeroParcela,
      valor: paraColuna(parcela.valor),
      dataMovimento: parcela.dataMovimento,
      status: "previsto",
    }));

    const auditoria: NovaAuditoria = {
      tabela: "movimento",
      registroId: movimentoId,
      acao: "INSERCAO",
      estadoAnterior: null,
      estadoAtual: { ...novoMovimento, parcelas: novasParcelas },
      alteradoPor: entrada.criadoPor,
    };

    return this.repositorio.persistirOperacao({
      movimentos: [novoMovimento],
      parcelas: novasParcelas,
      atualizacoesSaldoConta: [],
      auditorias: [auditoria],
    });
  }
}
