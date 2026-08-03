import { randomUUID } from "node:crypto";
import {
  arredondar,
  deISOParaData,
  paraColuna,
  paraNumero,
  schemaCorrigirMovimento,
  schemaCriarMovimento,
} from "@lancai/tipos";
import type { EntradaCorrigirMovimento, EntradaCriarMovimento } from "@lancai/tipos";
import type { Movimento, NovaAuditoria, NovaParcela, NovoMovimento } from "@lancai/banco";
import { calcular_saldo, obter_direcao_padrao, tipo_movimento_implementado } from "./calcular-saldo";
import { eh_fluxo_cruzado } from "./fluxo-cruzado";
import { registrar_parcelamento } from "./registrar-parcelamento";
import {
  ErroLimiteCartaoExcedido,
  ErroRecursoNaoEncontrado,
  ErroTipoMovimentoNaoImplementado,
  ErroValidacaoFinanceira,
} from "./erros";
import type { OperacaoCorrecao, RepositorioFinanceiro, ResultadoOperacaoPersistencia } from "./repositorio";

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
      if (entrada.formaPagamento === "debito") {
        return this.criar_movimento_debito_cartao(entrada);
      }
      return this.criar_movimento_credito_cartao(entrada);
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
      formaPagamento: entrada.formaPagamento ?? "pix",
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
      estadoAtual: { ...novoMovimento, fluxoCruzado: eh_fluxo_cruzado(entrada.perfil, conta.perfil) },
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

    const formaTransferencia = entrada.formaPagamento ?? "transferencia";

    const movimentoOrigem: NovoMovimento = {
      id: idOrigem,
      descricao: `${entrada.descricao} (enviado para ${contaDestino.nome})`,
      valor: paraColuna(entrada.valor),
      tipo: "transferencia",
      status: entrada.status,
      perfil: entrada.perfil,
      formaPagamento: formaTransferencia,
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
      formaPagamento: formaTransferencia,
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

  /**
   * Compra no crédito: consome limite, gera parcelas, não mexe no saldo da conta.
   */
  private async criar_movimento_credito_cartao(entrada: EntradaCriarMovimento): Promise<ResultadoCriarMovimento> {
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
    if (cartao.modalidade === "debito") {
      throw new ErroValidacaoFinanceira(
        `O cartão "${cartao.nome}" é só de débito. Use "no débito" ou cadastre um cartão de crédito/múltiplo.`,
      );
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
      formaPagamento: "credito",
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
      estadoAtual: {
        ...novoMovimento,
        parcelas: novasParcelas,
        fluxoCruzado: eh_fluxo_cruzado(entrada.perfil, cartao.perfil),
      },
      alteradoPor: entrada.criadoPor,
    };

    return this.repositorio.persistirOperacao({
      movimentos: [novoMovimento],
      parcelas: novasParcelas,
      atualizacoesSaldoConta: [],
      auditorias: [auditoria],
    });
  }

  /**
   * Compra no débito do cartão: baixa o saldo da conta vinculada na hora,
   * sem parcelas e sem consumir limite.
   */
  private async criar_movimento_debito_cartao(entrada: EntradaCriarMovimento): Promise<ResultadoCriarMovimento> {
    if (!tipo_movimento_implementado(entrada.tipo)) {
      throw new ErroTipoMovimentoNaoImplementado(entrada.tipo);
    }
    if (entrada.parcelamento) {
      throw new ErroValidacaoFinanceira("Parcelamento só é suportado em compras no crédito.");
    }

    const cartao = await this.repositorio.obterCartao(entrada.cartaoId as string);
    if (!cartao) {
      throw new ErroRecursoNaoEncontrado("cartao", entrada.cartaoId as string);
    }
    if (!cartao.ativo) {
      throw new ErroValidacaoFinanceira(`Cartão "${cartao.nome}" está inativo.`);
    }
    if (cartao.modalidade === "credito") {
      throw new ErroValidacaoFinanceira(
        `O cartão "${cartao.nome}" é só de crédito. Para usar débito, vincule uma conta a ele (fica múltiplo).`,
      );
    }
    if (!cartao.contaId) {
      throw new ErroValidacaoFinanceira(
        `O cartão "${cartao.nome}" não tem conta vinculada. Vincule uma conta para pagar no débito.`,
      );
    }

    const conta = await this.repositorio.obterConta(cartao.contaId);
    if (!conta) {
      throw new ErroRecursoNaoEncontrado("conta", cartao.contaId);
    }
    if (!conta.ativo) {
      throw new ErroValidacaoFinanceira(`Conta "${conta.nome}" vinculada ao cartão está inativa.`);
    }

    const movimentoId = randomUUID();
    const novoMovimento: NovoMovimento = {
      id: movimentoId,
      descricao: entrada.descricao,
      valor: paraColuna(entrada.valor),
      tipo: entrada.tipo,
      status: entrada.status,
      perfil: entrada.perfil,
      formaPagamento: "debito",
      dataMovimento: entrada.dataMovimento,
      cartaoId: cartao.id,
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
      estadoAtual: {
        ...novoMovimento,
        fluxoCruzado: eh_fluxo_cruzado(entrada.perfil, cartao.perfil),
      },
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
   * Corrige um lançamento existente (ex.: "corrige o combustível de ontem para R$ 210",
   * "muda o notebook de 10x pra 12x"). Nunca apaga o registro anterior — grava auditoria
   * e, quando necessário, ajusta saldo e regenera parcelas (append-only: parcelas antigas
   * ficam com status `cancelado`).
   */
  async corrigir_movimento(entradaBruta: EntradaCorrigirMovimento): Promise<Movimento> {
    const entrada = schemaCorrigirMovimento.parse(entradaBruta);

    const movimentoAtual = await this.repositorio.obterMovimento(entrada.movimentoId);
    if (!movimentoAtual) {
      throw new ErroRecursoNaoEncontrado("movimento", entrada.movimentoId);
    }
    if (movimentoAtual.status === "cancelado") {
      throw new ErroValidacaoFinanceira("Esse lançamento já está cancelado e não pode ser alterado.");
    }

    const campos = entrada.campos;
    const camposParaAtualizar: Partial<NovoMovimento> = {};

    if (campos.descricao !== undefined) camposParaAtualizar.descricao = campos.descricao;
    if (campos.dataMovimento !== undefined) camposParaAtualizar.dataMovimento = campos.dataMovimento;
    if (campos.status !== undefined) camposParaAtualizar.status = campos.status;
    if (campos.valor !== undefined) camposParaAtualizar.valor = paraColuna(campos.valor);
    if (campos.perfil !== undefined) camposParaAtualizar.perfil = campos.perfil;
    if (campos.formaPagamento !== undefined) camposParaAtualizar.formaPagamento = campos.formaPagamento;

    if (campos.categoriaId !== undefined) {
      const categoria = await this.repositorio.obterCategoria(campos.categoriaId);
      if (!categoria) throw new ErroRecursoNaoEncontrado("categoria", campos.categoriaId);
      camposParaAtualizar.categoriaId = campos.categoriaId;
    }
    if (campos.contaId !== undefined) {
      const conta = await this.repositorio.obterConta(campos.contaId);
      if (!conta) throw new ErroRecursoNaoEncontrado("conta", campos.contaId);
      camposParaAtualizar.contaId = campos.contaId;
    }
    if (campos.cartaoId !== undefined) {
      const cartao = await this.repositorio.obterCartao(campos.cartaoId);
      if (!cartao) throw new ErroRecursoNaoEncontrado("cartao", campos.cartaoId);
      camposParaAtualizar.cartaoId = campos.cartaoId;
    }
    if (campos.pessoaId !== undefined) {
      const pessoa = await this.repositorio.obterPessoa(campos.pessoaId);
      if (!pessoa) throw new ErroRecursoNaoEncontrado("pessoa", campos.pessoaId);
      camposParaAtualizar.pessoaId = campos.pessoaId;
    }

    camposParaAtualizar.alteradoPor = entrada.alteradoPor;

    const atualizacoesSaldoConta = await this.calcular_ajustes_saldo_na_correcao(movimentoAtual, campos);

    const regenerarParcelas = await this.preparar_regeneracao_parcelas(movimentoAtual, campos);

    const auditoria: NovaAuditoria = {
      tabela: "movimento",
      registroId: entrada.movimentoId,
      acao: campos.status === "cancelado" ? "CANCELAMENTO" : "ALTERACAO",
      estadoAnterior: movimentoAtual,
      estadoAtual: { ...movimentoAtual, ...camposParaAtualizar },
      alteradoPor: entrada.alteradoPor,
    };

    return this.repositorio.corrigirMovimento({
      movimentoId: entrada.movimentoId,
      campos: camposParaAtualizar,
      atualizacoesSaldoConta,
      auditoria,
      regenerarParcelas,
    });
  }

  /**
   * Calcula os deltas de `saldo_atual` necessários para a correção:
   * - mudança de valor na mesma conta;
   * - troca segura de conta (reverte na antiga, aplica na nova);
   * - cancelamento (reverte o efeito do lançamento realizado).
   * Movimentos em cartão / transferência não mexem em saldo de conta aqui.
   */
  private async calcular_ajustes_saldo_na_correcao(
    movimentoAtual: Movimento,
    campos: EntradaCorrigirMovimento["campos"],
  ): Promise<Array<{ contaId: string; saldoAtual: number }>> {
    if (movimentoAtual.tipo === "transferencia" || movimentoAtual.cartaoId) {
      return [];
    }

    const direcao = obter_direcao_padrao(movimentoAtual.tipo);
    if (direcao === undefined) {
      throw new ErroTipoMovimentoNaoImplementado(movimentoAtual.tipo);
    }

    const valorAntigo = paraNumero(movimentoAtual.valor);
    const valorNovo = campos.valor ?? valorAntigo;
    const contaAntigaId = movimentoAtual.contaId;
    const contaNovaId = campos.contaId ?? contaAntigaId;
    const statusNovo = campos.status ?? movimentoAtual.status;
    const atualizacoes = new Map<string, number>();

    const obter_saldo_base = async (contaId: string): Promise<number> => {
      if (atualizacoes.has(contaId)) return atualizacoes.get(contaId) as number;
      const conta = await this.repositorio.obterConta(contaId);
      if (!conta) throw new ErroRecursoNaoEncontrado("conta", contaId);
      return paraNumero(conta.saldoAtual);
    };

    // Só mexe em saldo se o movimento estava (ou continua) realizado.
    if (movimentoAtual.status !== "realizado") {
      return [];
    }

    if (statusNovo === "cancelado") {
      if (contaAntigaId) {
        const saldo = await obter_saldo_base(contaAntigaId);
        atualizacoes.set(contaAntigaId, arredondar(saldo - direcao * valorAntigo));
      }
      return [...atualizacoes.entries()].map(([contaId, saldoAtual]) => ({ contaId, saldoAtual }));
    }

    if (contaAntigaId && contaNovaId && contaAntigaId !== contaNovaId) {
      const saldoAntiga = await obter_saldo_base(contaAntigaId);
      const saldoNova = await obter_saldo_base(contaNovaId);
      atualizacoes.set(contaAntigaId, arredondar(saldoAntiga - direcao * valorAntigo));
      atualizacoes.set(contaNovaId, arredondar(saldoNova + direcao * valorNovo));
      return [...atualizacoes.entries()].map(([contaId, saldoAtual]) => ({ contaId, saldoAtual }));
    }

    if (campos.valor !== undefined && contaNovaId) {
      const saldo = await obter_saldo_base(contaNovaId);
      atualizacoes.set(contaNovaId, arredondar(saldo + direcao * (valorNovo - valorAntigo)));
    }

    return [...atualizacoes.entries()].map(([contaId, saldoAtual]) => ({ contaId, saldoAtual }));
  }

  /**
   * Se o lançamento é no cartão e mudou valor, data, número de parcelas ou cartão,
   * cancela as parcelas antigas e gera um novo conjunto coerente com o cartão.
   */
  private async preparar_regeneracao_parcelas(
    movimentoAtual: Movimento,
    campos: EntradaCorrigirMovimento["campos"],
  ): Promise<OperacaoCorrecao["regenerarParcelas"] | undefined> {
    const cartaoId = campos.cartaoId ?? movimentoAtual.cartaoId;
    if (!cartaoId) {
      if (campos.parcelas !== undefined) {
        throw new ErroValidacaoFinanceira("Só dá para alterar o número de parcelas de uma compra no cartão.");
      }
      return undefined;
    }

    const parcelasAtuais = await this.repositorio.listarParcelasDoMovimento(movimentoAtual.id);
    const precisaRegenerar =
      campos.valor !== undefined ||
      campos.dataMovimento !== undefined ||
      campos.parcelas !== undefined ||
      campos.cartaoId !== undefined ||
      campos.status === "cancelado";

    if (!precisaRegenerar || parcelasAtuais.length === 0) {
      return undefined;
    }

    if (campos.status === "cancelado") {
      return { novasParcelas: [] };
    }

    const cartao = await this.repositorio.obterCartao(cartaoId);
    if (!cartao) throw new ErroRecursoNaoEncontrado("cartao", cartaoId);

    const valorNovo = campos.valor ?? paraNumero(movimentoAtual.valor);
    const quantidade =
      campos.parcelas ?? (parcelasAtuais.length >= 2 ? parcelasAtuais.length : 1);
    const dataCompra = deISOParaData(campos.dataMovimento ?? movimentoAtual.dataMovimento);

    const parcelasCalculadas = registrar_parcelamento(valorNovo, quantidade, dataCompra, {
      fechamento: cartao.fechamento,
      vencimento: cartao.vencimento,
    });

    // Limite: desconsidera o comprometido deste próprio movimento (que será cancelado).
    const comprometidoAtual = await this.repositorio.obterTotalComprometidoCartao(cartaoId);
    const comprometidoDesteMovimento = parcelasAtuais.reduce(
      (soma, parcela) => soma + paraNumero(parcela.valor),
      0,
    );
    const comprometidoSemEste = arredondar(comprometidoAtual - comprometidoDesteMovimento);
    const limite = paraNumero(cartao.limite);
    if (comprometidoSemEste + valorNovo > limite) {
      throw new ErroLimiteCartaoExcedido(cartao.nome, limite, comprometidoSemEste + valorNovo);
    }

    const novasParcelas: NovaParcela[] = parcelasCalculadas.map((parcela) => ({
      movimentoId: movimentoAtual.id,
      numeroParcela: parcela.numeroParcela,
      valor: paraColuna(parcela.valor),
      dataMovimento: parcela.dataMovimento,
      status: "previsto",
    }));

    return { novasParcelas };
  }
}
