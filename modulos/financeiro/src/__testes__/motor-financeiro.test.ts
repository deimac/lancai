import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Cartao, Categoria, Conta, Pessoa } from "@lancai/banco";
import { MotorFinanceiro } from "../motor-financeiro";
import { RepositorioFinanceiroMemoria } from "../repositorio-memoria";
import { ErroLimiteCartaoExcedido, ErroRecursoNaoEncontrado, ErroValidacaoFinanceira } from "../erros";

function criarConta(sobrepor: Partial<Conta> = {}): Conta {
  const agora = new Date();
  return {
    id: randomUUID(),
    nome: "Nubank",
    saldoInicial: "0.00",
    saldoAtual: "1000.00",
    perfil: "pf",
    ativo: true,
    usuarioId: randomUUID(),
    dataCriacao: agora,
    dataAtualizacao: agora,
    ...sobrepor,
  };
}

function criarCartao(contaId: string, sobrepor: Partial<Cartao> = {}): Cartao {
  const agora = new Date();
  return {
    id: randomUUID(),
    nome: "Inter Black",
    limite: "5000.00",
    fechamento: 20,
    vencimento: 27,
    melhorDiaCompra: 21,
    perfil: "pf",
    modalidade: "multiplo",
    ativo: true,
    final4: null,
    dadosPlasticosCifrados: null,
    contaId,
    usuarioId: randomUUID(),
    dataCriacao: agora,
    dataAtualizacao: agora,
    ...sobrepor,
  };
}

function criarCategoria(sobrepor: Partial<Categoria> = {}): Categoria {
  const agora = new Date();
  return {
    id: randomUUID(),
    nome: "Combustível",
    tipo: "despesa",
    ativo: true,
    usuarioId: randomUUID(),
    dataCriacao: agora,
    dataAtualizacao: agora,
    ...sobrepor,
  };
}

function criarPessoa(sobrepor: Partial<Pessoa> = {}): Pessoa {
  const agora = new Date();
  return {
    id: randomUUID(),
    nome: "João",
    tipo: "cliente",
    ativo: true,
    usuarioId: randomUUID(),
    dataCriacao: agora,
    dataAtualizacao: agora,
    ...sobrepor,
  };
}

describe("MotorFinanceiro", () => {
  let repositorio: RepositorioFinanceiroMemoria;
  let motor: MotorFinanceiro;
  let usuarioId: string;
  let categoria: Categoria;

  beforeEach(() => {
    repositorio = new RepositorioFinanceiroMemoria();
    motor = new MotorFinanceiro(repositorio);
    usuarioId = randomUUID();
    categoria = criarCategoria({ usuarioId });
    repositorio.categorias.set(categoria.id, categoria);
  });

  describe("despesa em conta", () => {
    it("diminui o saldo da conta quando o movimento é realizado", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
      repositorio.contas.set(conta.id, conta);

      const resultado = await motor.criar_movimento({
        descricao: "Combustível",
        valor: 185,
        tipo: "despesa",
        status: "realizado",
        perfil: "pf",
        dataMovimento: "2026-07-31",
        contaId: conta.id,
        categoriaId: categoria.id,
        usuarioId,
        criadoPor: usuarioId,
      });

      expect(resultado.movimentos).toHaveLength(1);
      expect(resultado.movimentos[0]?.valor).toBe("185.00");

      const contaAtualizada = await repositorio.obterConta(conta.id);
      expect(contaAtualizada?.saldoAtual).toBe("815");

      expect(repositorio.auditorias).toHaveLength(1);
      expect(repositorio.auditorias[0]?.acao).toBe("INSERCAO");
    });

    it("não altera o saldo quando o status é 'previsto'", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
      repositorio.contas.set(conta.id, conta);

      await motor.criar_movimento({
        descricao: "Aluguel de dezembro",
        valor: 1500,
        tipo: "despesa",
        status: "previsto",
        perfil: "pf",
        dataMovimento: "2026-12-05",
        contaId: conta.id,
        categoriaId: categoria.id,
        usuarioId,
        criadoPor: usuarioId,
      });

      const contaAtualizada = await repositorio.obterConta(conta.id);
      expect(contaAtualizada?.saldoAtual).toBe("1000.00");
    });

    it("lança erro se a conta não existe", async () => {
      await expect(
        motor.criar_movimento({
          descricao: "Combustível",
          valor: 185,
          tipo: "despesa",
          status: "realizado",
          perfil: "pf",
          dataMovimento: "2026-07-31",
          contaId: randomUUID(),
          categoriaId: categoria.id,
          usuarioId,
          criadoPor: usuarioId,
        }),
      ).rejects.toThrow(ErroRecursoNaoEncontrado);
    });

    it("lança erro se a categoria não existe", async () => {
      const conta = criarConta({ usuarioId });
      repositorio.contas.set(conta.id, conta);

      await expect(
        motor.criar_movimento({
          descricao: "Combustível",
          valor: 185,
          tipo: "despesa",
          status: "realizado",
          perfil: "pf",
          dataMovimento: "2026-07-31",
          contaId: conta.id,
          categoriaId: randomUUID(),
          usuarioId,
          criadoPor: usuarioId,
        }),
      ).rejects.toThrow(ErroRecursoNaoEncontrado);
    });

  });

  describe("novos tipos de movimento (Fase 3)", () => {
    it.each([
      ["reembolso", 1],
      ["estorno", 1],
      ["aporte", 1],
      ["retirada", -1],
      ["emprestimo", -1],
    ] as const)("'%s' altera o saldo na direção esperada (%i)", async (tipo, direcao) => {
      const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
      repositorio.contas.set(conta.id, conta);

      await motor.criar_movimento({
        descricao: `Movimento ${tipo}`,
        valor: 100,
        tipo,
        status: "realizado",
        perfil: "pf",
        dataMovimento: "2026-07-31",
        contaId: conta.id,
        categoriaId: categoria.id,
        usuarioId,
        criadoPor: usuarioId,
      });

      const contaAtualizada = await repositorio.obterConta(conta.id);
      expect(Number(contaAtualizada?.saldoAtual)).toBe(1000 + direcao * 100);
    });
  });

  describe("fluxo cruzado PF/PJ", () => {
    it("marca o movimento como fluxo cruzado quando o perfil do movimento difere do perfil da conta", async () => {
      const contaEmpresa = criarConta({ usuarioId, perfil: "pj", saldoAtual: "1000.00" });
      const pessoa = criarPessoa({ usuarioId });
      repositorio.contas.set(contaEmpresa.id, contaEmpresa);
      repositorio.pessoas.set(pessoa.id, pessoa);

      await motor.criar_movimento({
        descricao: "Churrasco do Marcio",
        valor: 100,
        tipo: "despesa",
        status: "realizado",
        perfil: "pf",
        dataMovimento: "2026-07-31",
        contaId: contaEmpresa.id,
        categoriaId: categoria.id,
        pessoaId: pessoa.id,
        usuarioId,
        criadoPor: usuarioId,
      });

      const auditoria = repositorio.auditorias[0];
      expect((auditoria?.estadoAtual as { fluxoCruzado?: boolean })?.fluxoCruzado).toBe(true);
    });

    it("não marca como fluxo cruzado quando os perfis coincidem", async () => {
      const conta = criarConta({ usuarioId, perfil: "pf", saldoAtual: "1000.00" });
      repositorio.contas.set(conta.id, conta);

      await motor.criar_movimento({
        descricao: "Combustível",
        valor: 100,
        tipo: "despesa",
        status: "realizado",
        perfil: "pf",
        dataMovimento: "2026-07-31",
        contaId: conta.id,
        categoriaId: categoria.id,
        usuarioId,
        criadoPor: usuarioId,
      });

      const auditoria = repositorio.auditorias[0];
      expect((auditoria?.estadoAtual as { fluxoCruzado?: boolean })?.fluxoCruzado).toBe(false);
    });
  });

  describe("corrigir_movimento", () => {
    it("atualiza o valor e ajusta o saldo da conta pela diferença", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
      repositorio.contas.set(conta.id, conta);

      const resultado = await motor.criar_movimento({
        descricao: "Combustível",
        valor: 185,
        tipo: "despesa",
        status: "realizado",
        perfil: "pf",
        dataMovimento: "2026-07-31",
        contaId: conta.id,
        categoriaId: categoria.id,
        usuarioId,
        criadoPor: usuarioId,
      });
      const movimentoId = resultado.movimentos[0]!.id;

      const corrigido = await motor.corrigir_movimento({
        movimentoId,
        alteradoPor: usuarioId,
        campos: { valor: 210 },
      });

      expect(corrigido.valor).toBe("210.00");

      const contaAtualizada = await repositorio.obterConta(conta.id);
      // saldo original 815 (1000 - 185) - diferença extra de 25 (210 - 185) = 790
      expect(Number(contaAtualizada?.saldoAtual)).toBe(790);

      expect(repositorio.auditorias).toHaveLength(2);
      expect(repositorio.auditorias[1]?.acao).toBe("ALTERACAO");
    });

    it("permite corrigir apenas descrição/categoria sem mexer no saldo", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
      const outraCategoria = criarCategoria({ usuarioId, nome: "Alimentação" });
      repositorio.contas.set(conta.id, conta);
      repositorio.categorias.set(outraCategoria.id, outraCategoria);

      const resultado = await motor.criar_movimento({
        descricao: "Combustível",
        valor: 185,
        tipo: "despesa",
        status: "realizado",
        perfil: "pf",
        dataMovimento: "2026-07-31",
        contaId: conta.id,
        categoriaId: categoria.id,
        usuarioId,
        criadoPor: usuarioId,
      });
      const movimentoId = resultado.movimentos[0]!.id;

      const corrigido = await motor.corrigir_movimento({
        movimentoId,
        alteradoPor: usuarioId,
        campos: { descricao: "Mercado", categoriaId: outraCategoria.id },
      });

      expect(corrigido.descricao).toBe("Mercado");
      expect(corrigido.categoriaId).toBe(outraCategoria.id);

      const contaAtualizada = await repositorio.obterConta(conta.id);
      expect(contaAtualizada?.saldoAtual).toBe("815");
    });

    it("lança erro se o movimento não existe", async () => {
      await expect(
        motor.corrigir_movimento({
          movimentoId: randomUUID(),
          alteradoPor: usuarioId,
          campos: { descricao: "Novo" },
        }),
      ).rejects.toThrow(ErroRecursoNaoEncontrado);
    });

    it("lança erro se a nova categoria não existe", async () => {
      const conta = criarConta({ usuarioId });
      repositorio.contas.set(conta.id, conta);

      const resultado = await motor.criar_movimento({
        descricao: "Combustível",
        valor: 185,
        tipo: "despesa",
        status: "realizado",
        perfil: "pf",
        dataMovimento: "2026-07-31",
        contaId: conta.id,
        categoriaId: categoria.id,
        usuarioId,
        criadoPor: usuarioId,
      });

      await expect(
        motor.corrigir_movimento({
          movimentoId: resultado.movimentos[0]!.id,
          alteradoPor: usuarioId,
          campos: { categoriaId: randomUUID() },
        }),
      ).rejects.toThrow(ErroRecursoNaoEncontrado);
    });

    it("troca a conta de um movimento realizado ajustando os dois saldos", async () => {
      const contaOrigem = criarConta({ usuarioId, nome: "Nubank", saldoAtual: "1000.00" });
      const contaDestino = criarConta({ usuarioId, nome: "Inter", saldoAtual: "500.00" });
      repositorio.contas.set(contaOrigem.id, contaOrigem);
      repositorio.contas.set(contaDestino.id, contaDestino);

      const resultado = await motor.criar_movimento({
        descricao: "Almoço",
        valor: 50,
        tipo: "despesa",
        status: "realizado",
        perfil: "pf",
        dataMovimento: "2026-08-01",
        contaId: contaOrigem.id,
        categoriaId: categoria.id,
        usuarioId,
        criadoPor: usuarioId,
      });

      await motor.corrigir_movimento({
        movimentoId: resultado.movimentos[0]!.id,
        alteradoPor: usuarioId,
        campos: { contaId: contaDestino.id },
      });

      // Origem: 1000 - 50 = 950, depois reverte (+50) = 1000
      expect(Number((await repositorio.obterConta(contaOrigem.id))?.saldoAtual)).toBe(1000);
      // Destino: 500 - 50 = 450
      expect(Number((await repositorio.obterConta(contaDestino.id))?.saldoAtual)).toBe(450);
    });

    it("cancela um lançamento e devolve o valor ao saldo da conta", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
      repositorio.contas.set(conta.id, conta);

      const resultado = await motor.criar_movimento({
        descricao: "Almoço",
        valor: 50,
        tipo: "despesa",
        status: "realizado",
        perfil: "pf",
        dataMovimento: "2026-08-01",
        contaId: conta.id,
        categoriaId: categoria.id,
        usuarioId,
        criadoPor: usuarioId,
      });

      const cancelado = await motor.corrigir_movimento({
        movimentoId: resultado.movimentos[0]!.id,
        alteradoPor: usuarioId,
        campos: { status: "cancelado" },
      });

      expect(cancelado.status).toBe("cancelado");
      expect(Number((await repositorio.obterConta(conta.id))?.saldoAtual)).toBe(1000);
      expect(repositorio.auditorias.at(-1)?.acao).toBe("CANCELAMENTO");
    });

    it("regenera parcelas ao mudar o número de parcelas de uma compra no cartão", async () => {
      const conta = criarConta({ usuarioId });
      const cartao = criarCartao(conta.id, { usuarioId, limite: "10000.00", fechamento: 20, vencimento: 27 });
      repositorio.contas.set(conta.id, conta);
      repositorio.cartoes.set(cartao.id, cartao);

      const resultado = await motor.criar_movimento({
        descricao: "Notebook",
        valor: 3000,
        tipo: "despesa",
        status: "realizado",
        perfil: "pf",
        dataMovimento: "2026-08-01",
        cartaoId: cartao.id,
        categoriaId: categoria.id,
        usuarioId,
        criadoPor: usuarioId,
        parcelamento: { quantidadeParcelas: 10 },
      });
      expect(resultado.parcelas).toHaveLength(10);

      await motor.corrigir_movimento({
        movimentoId: resultado.movimentos[0]!.id,
        alteradoPor: usuarioId,
        campos: { parcelas: 12 },
      });

      const parcelasAtivas = await repositorio.listarParcelasDoMovimento(resultado.movimentos[0]!.id);
      expect(parcelasAtivas).toHaveLength(12);
      expect(parcelasAtivas.every((parcela) => parcela.valor === "250.00")).toBe(true);

      const canceladas = [...repositorio.parcelas.values()].filter(
        (parcela) => parcela.movimentoId === resultado.movimentos[0]!.id && parcela.status === "cancelado",
      );
      expect(canceladas).toHaveLength(10);
    });
  });

  describe("receita em conta", () => {
    it("aumenta o saldo da conta associada à pessoa", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "500.00" });
      const pessoa = criarPessoa({ usuarioId });
      repositorio.contas.set(conta.id, conta);
      repositorio.pessoas.set(pessoa.id, pessoa);

      await motor.criar_movimento({
        descricao: "Recebimento de João",
        valor: 2500,
        tipo: "receita",
        status: "realizado",
        perfil: "pf",
        dataMovimento: "2026-08-01",
        contaId: conta.id,
        categoriaId: categoria.id,
        pessoaId: pessoa.id,
        usuarioId,
        criadoPor: usuarioId,
      });

      const contaAtualizada = await repositorio.obterConta(conta.id);
      expect(contaAtualizada?.saldoAtual).toBe("3000");
    });
  });

  describe("transferência", () => {
    it("gera duas linhas de movimento e ajusta o saldo das duas contas", async () => {
      const contaOrigem = criarConta({ usuarioId, nome: "Nubank", saldoAtual: "1000.00" });
      const contaDestino = criarConta({ usuarioId, nome: "Inter", saldoAtual: "200.00" });
      repositorio.contas.set(contaOrigem.id, contaOrigem);
      repositorio.contas.set(contaDestino.id, contaDestino);

      const resultado = await motor.criar_movimento({
        descricao: "Reserva de emergência",
        valor: 300,
        tipo: "transferencia",
        status: "realizado",
        perfil: "pf",
        dataMovimento: "2026-08-01",
        contaId: contaOrigem.id,
        contaDestinoId: contaDestino.id,
        categoriaId: categoria.id,
        usuarioId,
        criadoPor: usuarioId,
      });

      expect(resultado.movimentos).toHaveLength(2);

      const origemAtualizada = await repositorio.obterConta(contaOrigem.id);
      const destinoAtualizada = await repositorio.obterConta(contaDestino.id);
      expect(origemAtualizada?.saldoAtual).toBe("700");
      expect(destinoAtualizada?.saldoAtual).toBe("500");
    });
  });

  describe("compra parcelada no cartão", () => {
    it("cria o movimento pai e as parcelas com datas respeitando o fechamento/vencimento", async () => {
      const conta = criarConta({ usuarioId });
      const cartao = criarCartao(conta.id, { usuarioId, fechamento: 20, vencimento: 27, limite: "10000.00" });
      repositorio.contas.set(conta.id, conta);
      repositorio.cartoes.set(cartao.id, cartao);

      const resultado = await motor.criar_movimento({
        descricao: "Notebook",
        valor: 8000,
        tipo: "despesa",
        status: "realizado",
        perfil: "pf",
        dataMovimento: "2026-07-15",
        cartaoId: cartao.id,
        categoriaId: categoria.id,
        usuarioId,
        criadoPor: usuarioId,
        parcelamento: { quantidadeParcelas: 10 },
      });

      expect(resultado.movimentos).toHaveLength(1);
      expect(resultado.parcelas).toHaveLength(10);
      expect(resultado.parcelas.every((parcela) => parcela.valor === "800.00")).toBe(true);
      // Compra em 15/07, fechamento dia 20 -> entra na fatura corrente, vencimento 27/08.
      expect(resultado.parcelas[0]?.dataMovimento).toBe("2026-08-27");
      expect(resultado.parcelas[1]?.dataMovimento).toBe("2026-09-27");
      expect(resultado.parcelas[9]?.dataMovimento).toBe("2027-05-27");

      // Compra no cartão não afeta o saldo da conta vinculada.
      const contaAtualizada = await repositorio.obterConta(conta.id);
      expect(contaAtualizada?.saldoAtual).toBe(conta.saldoAtual);
    });

    it("ajusta a última parcela para absorver a diferença de arredondamento", async () => {
      const conta = criarConta({ usuarioId });
      const cartao = criarCartao(conta.id, { usuarioId, limite: "10000.00" });
      repositorio.contas.set(conta.id, conta);
      repositorio.cartoes.set(cartao.id, cartao);

      const resultado = await motor.criar_movimento({
        descricao: "Passagem Iberia",
        valor: 2300,
        tipo: "despesa",
        status: "realizado",
        perfil: "pj",
        dataMovimento: "2026-07-10",
        cartaoId: cartao.id,
        categoriaId: categoria.id,
        usuarioId,
        criadoPor: usuarioId,
        parcelamento: { quantidadeParcelas: 5 },
      });

      const valores = resultado.parcelas.map((parcela) => parcela.valor);
      expect(valores).toEqual(["460.00", "460.00", "460.00", "460.00", "460.00"]);
    });

    it("compra em cartão gera uma única parcela quando não há parcelamento", async () => {
      const conta = criarConta({ usuarioId });
      const cartao = criarCartao(conta.id, { usuarioId, limite: "10000.00" });
      repositorio.contas.set(conta.id, conta);
      repositorio.cartoes.set(cartao.id, cartao);

      const resultado = await motor.criar_movimento({
        descricao: "Almoço",
        valor: 45,
        tipo: "despesa",
        status: "realizado",
        perfil: "pf",
        dataMovimento: "2026-07-10",
        cartaoId: cartao.id,
        categoriaId: categoria.id,
        usuarioId,
        criadoPor: usuarioId,
      });

      expect(resultado.parcelas).toHaveLength(1);
      expect(resultado.parcelas[0]?.numeroParcela).toBe(1);
    });

    it("lança erro quando o valor ultrapassa o limite disponível do cartão", async () => {
      const conta = criarConta({ usuarioId });
      const cartao = criarCartao(conta.id, { usuarioId, limite: "1000.00" });
      repositorio.contas.set(conta.id, conta);
      repositorio.cartoes.set(cartao.id, cartao);

      await expect(
        motor.criar_movimento({
          descricao: "TV",
          valor: 3000,
          tipo: "despesa",
          status: "realizado",
          perfil: "pf",
          dataMovimento: "2026-07-10",
          cartaoId: cartao.id,
          categoriaId: categoria.id,
          usuarioId,
          criadoPor: usuarioId,
          parcelamento: { quantidadeParcelas: 10 },
        }),
      ).rejects.toThrow(ErroLimiteCartaoExcedido);
    });

    it("considera parcelas já comprometidas de compras anteriores ao validar o limite", async () => {
      const conta = criarConta({ usuarioId });
      const cartao = criarCartao(conta.id, { usuarioId, limite: "1000.00" });
      repositorio.contas.set(conta.id, conta);
      repositorio.cartoes.set(cartao.id, cartao);

      await motor.criar_movimento({
        descricao: "Mercado",
        valor: 700,
        tipo: "despesa",
        status: "realizado",
        perfil: "pf",
        dataMovimento: "2026-07-10",
        cartaoId: cartao.id,
        categoriaId: categoria.id,
        usuarioId,
        criadoPor: usuarioId,
      });

      await expect(
        motor.criar_movimento({
          descricao: "Farmácia",
          valor: 400,
          tipo: "despesa",
          status: "realizado",
          perfil: "pf",
          dataMovimento: "2026-07-11",
          cartaoId: cartao.id,
          categoriaId: categoria.id,
          usuarioId,
          criadoPor: usuarioId,
        }),
      ).rejects.toThrow(ErroLimiteCartaoExcedido);
    });

    it("compra no crédito sem formaPagamento usa crédito e consome limite", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
      const cartao = criarCartao(conta.id, { usuarioId, modalidade: "credito", limite: "5000.00" });
      repositorio.contas.set(conta.id, conta);
      repositorio.cartoes.set(cartao.id, cartao);

      const resultado = await motor.criar_movimento({
        descricao: "Almoço",
        valor: 80,
        tipo: "despesa",
        status: "realizado",
        perfil: "pf",
        dataMovimento: "2026-07-10",
        cartaoId: cartao.id,
        categoriaId: categoria.id,
        usuarioId,
        criadoPor: usuarioId,
      });

      expect(resultado.movimentos[0]?.formaPagamento).toBe("credito");
      expect(resultado.parcelas).toHaveLength(1);
      expect(repositorio.contas.get(conta.id)?.saldoAtual).toBe("1000.00");
    });

    it("compra no débito baixa saldo da conta vinculada sem parcelas", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
      const cartao = criarCartao(conta.id, { usuarioId, modalidade: "multiplo", limite: "5000.00" });
      repositorio.contas.set(conta.id, conta);
      repositorio.cartoes.set(cartao.id, cartao);

      const resultado = await motor.criar_movimento({
        descricao: "Farmácia",
        valor: 120,
        tipo: "despesa",
        status: "realizado",
        perfil: "pf",
        formaPagamento: "debito",
        dataMovimento: "2026-07-10",
        cartaoId: cartao.id,
        categoriaId: categoria.id,
        usuarioId,
        criadoPor: usuarioId,
      });

      expect(resultado.movimentos[0]?.formaPagamento).toBe("debito");
      expect(resultado.movimentos[0]?.contaId).toBe(conta.id);
      expect(resultado.parcelas).toHaveLength(0);
      expect(Number(repositorio.contas.get(conta.id)?.saldoAtual)).toBe(880);
    });

    it("rejeita débito em cartão só de crédito", async () => {
      const conta = criarConta({ usuarioId });
      const cartao = criarCartao(conta.id, {
        usuarioId,
        modalidade: "credito",
        contaId: null,
      });
      repositorio.contas.set(conta.id, conta);
      repositorio.cartoes.set(cartao.id, cartao);

      await expect(
        motor.criar_movimento({
          descricao: "Farmácia",
          valor: 50,
          tipo: "despesa",
          status: "realizado",
          perfil: "pf",
          formaPagamento: "debito",
          dataMovimento: "2026-07-10",
          cartaoId: cartao.id,
          categoriaId: categoria.id,
          usuarioId,
          criadoPor: usuarioId,
        }),
      ).rejects.toThrow(ErroValidacaoFinanceira);
    });

    it("persiste forma pix em lançamento na conta", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "500.00" });
      repositorio.contas.set(conta.id, conta);

      const resultado = await motor.criar_movimento({
        descricao: "Mercado",
        valor: 90,
        tipo: "despesa",
        status: "realizado",
        perfil: "pf",
        formaPagamento: "pix",
        dataMovimento: "2026-07-10",
        contaId: conta.id,
        categoriaId: categoria.id,
        usuarioId,
        criadoPor: usuarioId,
      });

      expect(resultado.movimentos[0]?.formaPagamento).toBe("pix");
      expect(Number(repositorio.contas.get(conta.id)?.saldoAtual)).toBe(410);
    });

    it("assume pix quando lançamento em conta vem sem formaPagamento", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "500.00" });
      repositorio.contas.set(conta.id, conta);

      const resultado = await motor.criar_movimento({
        descricao: "Salário",
        valor: 200,
        tipo: "receita",
        status: "realizado",
        perfil: "pf",
        dataMovimento: "2026-07-10",
        contaId: conta.id,
        categoriaId: categoria.id,
        usuarioId,
        criadoPor: usuarioId,
      });

      expect(resultado.movimentos[0]?.formaPagamento).toBe("pix");
    });
  });
});
