import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Cartao, Categoria, Conta, Pessoa } from "@lancai/banco";
import type { EntradaCriarMovimento, EventoFinanceiroNormalizado } from "@lancai/tipos";
import { MotorFinanceiro } from "../motor-financeiro";
import type { ContextoIngestao } from "../motor-financeiro";
import { RepositorioFinanceiroMemoria } from "../repositorio-memoria";
import {
  ErroContaSincronizada,
  ErroFatoImutavel,
  ErroLimiteCartaoExcedido,
  ErroRecursoNaoEncontrado,
  ErroValidacaoFinanceira,
} from "../erros";

const WORKSPACE = "00000000-0000-4000-8000-000000000010";

function criarConta(sobrepor: Partial<Conta> = {}): Conta {
  const agora = new Date();
  return {
    id: randomUUID(),
    nome: "Nubank",
    saldoInicial: "0.00",
    saldoAtual: "1000.00",
    perfil: "pf",
    ativo: true,
    sincronizada: false,
    usuarioId: randomUUID(),
    workspaceId: WORKSPACE,
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
    saldo: "0",
    fechamento: 20,
    vencimento: 27,
    melhorDiaCompra: 21,
    perfil: "pf",
    modalidade: "multiplo",
    ativo: true,
    sincronizada: false,
    dadosPlasticosCifrados: null,
    contaId,
    usuarioId: randomUUID(),
    workspaceId: WORKSPACE,
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
    workspaceId: WORKSPACE,
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
    workspaceId: WORKSPACE,
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

  /** Evita repetir workspace e fonte, que são iguais em todos os casos manuais. */
  function criar_movimento(
    entrada: Omit<EntradaCriarMovimento, "workspaceId" | "fonte"> &
      Partial<Pick<EntradaCriarMovimento, "fonte">>,
  ) {
    return motor.criar_movimento({ workspaceId: WORKSPACE, fonte: "manual", ...entrada });
  }

  describe("despesa em conta", () => {
    it("diminui o saldo da conta quando o movimento é realizado", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
      repositorio.contas.set(conta.id, conta);

      const resultado = await criar_movimento({
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

      await criar_movimento({
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
        criar_movimento({
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
        criar_movimento({
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

      await criar_movimento({
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

      await criar_movimento({
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

      await criar_movimento({
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

      const resultado = await criar_movimento({
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

      const corrigido = await motor.corrigir_fato_manual({
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

    it("lança erro se o movimento não existe", async () => {
      await expect(
        motor.corrigir_fato_manual({
          movimentoId: randomUUID(),
          alteradoPor: usuarioId,
          campos: { valor: 10 },
        }),
      ).rejects.toThrow(ErroRecursoNaoEncontrado);
    });

    it("troca a conta de um movimento realizado ajustando os dois saldos", async () => {
      const contaOrigem = criarConta({ usuarioId, nome: "Nubank", saldoAtual: "1000.00" });
      const contaDestino = criarConta({ usuarioId, nome: "Inter", saldoAtual: "500.00" });
      repositorio.contas.set(contaOrigem.id, contaOrigem);
      repositorio.contas.set(contaDestino.id, contaDestino);

      const resultado = await criar_movimento({
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

      await motor.corrigir_fato_manual({
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

      const resultado = await criar_movimento({
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

      const cancelado = await motor.corrigir_fato_manual({
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

      const resultado = await criar_movimento({
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

      await motor.corrigir_fato_manual({
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

      await criar_movimento({
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

      const resultado = await criar_movimento({
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

      const resultado = await criar_movimento({
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

      const resultado = await criar_movimento({
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

      const resultado = await criar_movimento({
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
        criar_movimento({
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

      await criar_movimento({
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
        criar_movimento({
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

      const resultado = await criar_movimento({
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

      const resultado = await criar_movimento({
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
        criar_movimento({
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

      const resultado = await criar_movimento({
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

      const resultado = await criar_movimento({
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

  describe("fronteira entre Fato e Conhecimento", () => {
    function evento(sobrepor: Partial<EventoFinanceiroNormalizado> = {}): EventoFinanceiroNormalizado {
      return {
        workspaceId: WORKSPACE,
        fonte: "open_finance",
        provedor: "provedor_teste",
        idExterno: "tx-1",
        ocorridoEm: "2026-08-01",
        valor: 90,
        tipo: "despesa",
        descricaoFonte: "COMPRA CARTAO 1234 MERCADO XY",
        statusFonte: "confirmado",
        fatoImutavel: true,
        ...sobrepor,
      };
    }

    function contexto(): ContextoIngestao {
      return {
        usuarioId,
        criadoPor: usuarioId,
        categoriaIdNaoClassificado: categoria.id,
        perfilPadrao: "pf",
      };
    }

    it("recusa alterar o Fato de uma movimentação vinda de open_finance", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
      repositorio.contas.set(conta.id, conta);

      const { criados } = await motor.ingerir_eventos([evento({ contaId: conta.id })], contexto());

      await expect(
        motor.corrigir_fato_manual({
          movimentoId: criados[0]!.id,
          alteradoPor: usuarioId,
          campos: { valor: 500 },
        }),
      ).rejects.toThrow(ErroFatoImutavel);
    });

    it("mantém corrigível o Fato de uma movimentação manual", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
      repositorio.contas.set(conta.id, conta);

      const resultado = await criar_movimento({
        descricao: "Café",
        valor: 8,
        tipo: "despesa",
        status: "realizado",
        perfil: "pf",
        dataMovimento: "2026-08-01",
        contaId: conta.id,
        categoriaId: categoria.id,
        usuarioId,
        criadoPor: usuarioId,
      });

      const corrigido = await motor.corrigir_fato_manual({
        movimentoId: resultado.movimentos[0]!.id,
        alteradoPor: usuarioId,
        campos: { valor: 12 },
      });

      expect(corrigido.valor).toBe("12.00");
    });

    it("guarda a descrição original da instituição em descricao_fonte", async () => {
      const conta = criarConta({ usuarioId });
      repositorio.contas.set(conta.id, conta);

      const { criados } = await motor.ingerir_eventos([evento({ contaId: conta.id })], contexto());

      expect(criados[0]?.descricaoFonte).toBe("COMPRA CARTAO 1234 MERCADO XY");
      expect(criados[0]?.fonte).toBe("open_finance");
    });

    it("copia descricao para descricao_fonte em lançamento manual", async () => {
      const conta = criarConta({ usuarioId });
      repositorio.contas.set(conta.id, conta);

      const resultado = await criar_movimento({
        descricao: "Café",
        valor: 8,
        tipo: "despesa",
        status: "realizado",
        perfil: "pf",
        dataMovimento: "2026-08-01",
        contaId: conta.id,
        categoriaId: categoria.id,
        usuarioId,
        criadoPor: usuarioId,
      });

      expect(resultado.movimentos[0]?.descricaoFonte).toBe("Café");
    });

    it("não duplica ao reprocessar o mesmo lote", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
      repositorio.contas.set(conta.id, conta);

      const lote = [evento({ contaId: conta.id }), evento({ contaId: conta.id, idExterno: "tx-2" })];

      const primeira = await motor.ingerir_eventos(lote, contexto());
      const segunda = await motor.ingerir_eventos(lote, contexto());

      expect(primeira.criados).toHaveLength(2);
      expect(primeira.duplicados).toBe(0);
      expect(segunda.criados).toHaveLength(0);
      expect(segunda.duplicados).toBe(2);
      expect(repositorio.movimentos.size).toBe(2);
    });

    it("não acumula saldo_atual na conta — o saldo vem da instituição", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
      repositorio.contas.set(conta.id, conta);

      const lote = [evento({ contaId: conta.id })];
      await motor.ingerir_eventos(lote, contexto());
      await motor.ingerir_eventos(lote, contexto());

      expect(Number(repositorio.contas.get(conta.id)?.saldoAtual)).toBe(1000);
    });

    /**
     * Cada parcela é um Fato próprio, e não uma linha da tabela `parcela`.
     * Reconstruir a compra-mãe seria adivinhação; ver seção 8.7 de
     * 13-OPEN_FINANCE.md.
     */
    it("guarda o parcelamento que a instituição informou, sem criar parcelas", async () => {
      const conta = criarConta({ usuarioId });
      const cartao = criarCartao(conta.id, { usuarioId });
      repositorio.contas.set(conta.id, conta);
      repositorio.cartoes.set(cartao.id, cartao);

      const { criados } = await motor.ingerir_eventos(
        [
          evento({
            cartaoId: cartao.id,
            contaId: undefined,
            valor: 100,
            parcelamento: { numero: 3, total: 10, valorTotal: 1000, compraEm: "2026-06-15" },
          }),
        ],
        contexto(),
      );

      expect(criados[0]?.parcelaNumero).toBe(3);
      expect(criados[0]?.parcelaTotal).toBe(10);
      expect(criados[0]?.parcelaCompraValor).toBe("1000.00");
      expect(criados[0]?.parcelaCompraEm).toBe("2026-06-15");
      /** A tabela `parcela` é do lado manual e não é alimentada pela ingestão. */
      expect(repositorio.parcelas.size).toBe(0);
    });

    it("deixa as colunas de parcelamento nulas no que não é parcela", async () => {
      const conta = criarConta({ usuarioId });
      repositorio.contas.set(conta.id, conta);

      const { criados } = await motor.ingerir_eventos([evento({ contaId: conta.id })], contexto());

      expect(criados[0]?.parcelaNumero).toBeNull();
      expect(criados[0]?.parcelaTotal).toBeNull();
    });

    it("marca como previsto o que a instituição ainda não confirmou", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
      repositorio.contas.set(conta.id, conta);

      const { criados } = await motor.ingerir_eventos(
        [evento({ contaId: conta.id, statusFonte: "pendente" })],
        contexto(),
      );

      expect(criados[0]?.status).toBe("previsto");
      expect(Number(repositorio.contas.get(conta.id)?.saldoAtual)).toBe(1000);
    });
  });

  describe("alteração anunciada pela instituição", () => {
    function evento(sobrepor: Partial<EventoFinanceiroNormalizado> = {}): EventoFinanceiroNormalizado {
      return {
        workspaceId: WORKSPACE,
        fonte: "open_finance",
        provedor: "provedor_teste",
        idExterno: "tx-1",
        ocorridoEm: "2026-08-01",
        valor: 90,
        tipo: "despesa",
        descricaoFonte: "COMPRA CARTAO 1234 MERCADO XY",
        statusFonte: "confirmado",
        fatoImutavel: true,
        ...sobrepor,
      };
    }

    function contexto(): ContextoIngestao {
      return {
        usuarioId,
        criadoPor: usuarioId,
        categoriaIdNaoClassificado: categoria.id,
        perfilPadrao: "pf",
      };
    }

    async function ingerir(contaId: string, sobrepor: Partial<EventoFinanceiroNormalizado> = {}) {
      const { criados } = await motor.ingerir_eventos([evento({ contaId, ...sobrepor })], contexto());
      return criados[0]!;
    }

    it("reescreve o Fato que a instituição corrigiu", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
      repositorio.contas.set(conta.id, conta);
      await ingerir(conta.id);

      const { atualizados } = await motor.atualizar_fatos_da_fonte(
        [evento({ contaId: conta.id, valor: 95.5, descricaoFonte: "MERCADO XY LTDA" })],
        contexto(),
      );

      expect(atualizados[0]?.valor).toBe("95.50");
      expect(atualizados[0]?.descricaoFonte).toBe("MERCADO XY LTDA");
    });

    /**
     * O caso que o Pilar 1 existe para proteger: o banco corrigiu o extrato do
     * usuário, não a opinião dele sobre o extrato.
     */
    it("preserva o Conhecimento ao aplicar a alteração", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
      const pessoa = criarPessoa({ usuarioId });
      repositorio.contas.set(conta.id, conta);
      repositorio.pessoas.set(pessoa.id, pessoa);

      const criado = await ingerir(conta.id);
      const outraCategoria = criarCategoria({ usuarioId, nome: "Mercado" });
      repositorio.categorias.set(outraCategoria.id, outraCategoria);

      /** Simula o que o Conhecimento grava depois da ingestão. */
      repositorio.movimentos.set(criado.id, {
        ...criado,
        descricao: "Compras do mês",
        categoriaId: outraCategoria.id,
        pessoaId: pessoa.id,
        classificadoPor: "usuario",
        ignoradoEmRelatorio: true,
        observacoes: "dividido com a Ana",
      });

      const { atualizados } = await motor.atualizar_fatos_da_fonte(
        [evento({ contaId: conta.id, valor: 95.5, descricaoFonte: "MERCADO XY LTDA" })],
        contexto(),
      );

      const movimento = atualizados[0];
      expect(movimento?.valor).toBe("95.50");
      expect(movimento?.descricao).toBe("Compras do mês");
      expect(movimento?.categoriaId).toBe(outraCategoria.id);
      expect(movimento?.pessoaId).toBe(pessoa.id);
      expect(movimento?.classificadoPor).toBe("usuario");
      expect(movimento?.ignoradoEmRelatorio).toBe(true);
      expect(movimento?.observacoes).toBe("dividido com a Ana");
    });

    it("não mexe em saldo_atual ao corrigir valor de Fato open_finance", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
      repositorio.contas.set(conta.id, conta);
      await ingerir(conta.id);
      expect(Number(repositorio.contas.get(conta.id)?.saldoAtual)).toBe(1000);

      await motor.atualizar_fatos_da_fonte(
        [evento({ contaId: conta.id, valor: 95.5 })],
        contexto(),
      );

      expect(Number(repositorio.contas.get(conta.id)?.saldoAtual)).toBe(1000);
    });

    /** Pendente → confirmado muda o status do Fato; o saldo institucional não deriva disso. */
    it("confirma pendente sem alterar saldo_atual", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
      repositorio.contas.set(conta.id, conta);
      await ingerir(conta.id, { statusFonte: "pendente" });
      expect(Number(repositorio.contas.get(conta.id)?.saldoAtual)).toBe(1000);

      const { atualizados } = await motor.atualizar_fatos_da_fonte(
        [evento({ contaId: conta.id, statusFonte: "confirmado" })],
        contexto(),
      );

      expect(atualizados[0]?.status).toBe("realizado");
      expect(Number(repositorio.contas.get(conta.id)?.saldoAtual)).toBe(1000);
    });

    it("mantém saldo_atual quando a confirmada volta a pendente", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
      repositorio.contas.set(conta.id, conta);
      await ingerir(conta.id);

      await motor.atualizar_fatos_da_fonte(
        [evento({ contaId: conta.id, statusFonte: "pendente" })],
        contexto(),
      );

      expect(Number(repositorio.contas.get(conta.id)?.saldoAtual)).toBe(1000);
    });

    /**
     * A janela de recoleta de 4 a 7 dias reanuncia o que não mudou. Sem isto,
     * cada sincronização encheria a auditoria de linha sem diferença nenhuma.
     */
    it("não escreve nada quando o Fato chega idêntico", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
      repositorio.contas.set(conta.id, conta);
      await ingerir(conta.id);
      const auditoriasAntes = repositorio.auditorias.length;

      const resultado = await motor.atualizar_fatos_da_fonte(
        [evento({ contaId: conta.id })],
        contexto(),
      );

      expect(resultado.inalterados).toBe(1);
      expect(resultado.atualizados).toHaveLength(0);
      expect(repositorio.auditorias).toHaveLength(auditoriasAntes);
      expect(Number(repositorio.contas.get(conta.id)?.saldoAtual)).toBe(1000);
    });

    it("devolve como desconhecido o que nunca foi ingerido, sem criar nada", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
      repositorio.contas.set(conta.id, conta);

      const resultado = await motor.atualizar_fatos_da_fonte(
        [evento({ contaId: conta.id })],
        contexto(),
      );

      expect(resultado.desconhecidos).toHaveLength(1);
      expect(repositorio.movimentos.size).toBe(0);
      expect(Number(repositorio.contas.get(conta.id)?.saldoAtual)).toBe(1000);
    });

    /** Ressuscitar o que alguém cancelou exigiria saber por quê, e a fonte não sabe. */
    it("não ressuscita movimento cancelado", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
      repositorio.contas.set(conta.id, conta);
      const criado = await ingerir(conta.id);
      repositorio.movimentos.set(criado.id, { ...criado, status: "cancelado" });

      const { atualizados } = await motor.atualizar_fatos_da_fonte(
        [evento({ contaId: conta.id, valor: 95.5 })],
        contexto(),
      );

      expect(atualizados[0]?.status).toBe("cancelado");
    });

    it("registra a alteração na auditoria com o estado anterior", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
      repositorio.contas.set(conta.id, conta);
      await ingerir(conta.id);

      await motor.atualizar_fatos_da_fonte(
        [evento({ contaId: conta.id, valor: 95.5 })],
        contexto(),
      );

      const auditoria = repositorio.auditorias.at(-1);
      expect(auditoria?.acao).toBe("ALTERACAO");
      expect((auditoria?.estadoAnterior as { valor?: string })?.valor).toBe("90.00");
      expect((auditoria?.estadoAtual as { valor?: string })?.valor).toBe("95.50");
    });

    /** Cartão que reprocessa uma compra costuma reemitir as parcelas diferentes. */
    it("aplica a correção de parcelamento vinda da instituição", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
      repositorio.contas.set(conta.id, conta);
      await ingerir(conta.id, {
        parcelamento: { numero: 3, total: 10, valorTotal: 1000, compraEm: "2026-06-15" },
      });

      const { atualizados } = await motor.atualizar_fatos_da_fonte(
        [
          evento({
            contaId: conta.id,
            parcelamento: { numero: 3, total: 12, valorTotal: 1200, compraEm: "2026-06-15" },
          }),
        ],
        contexto(),
      );

      expect(atualizados[0]?.parcelaTotal).toBe(12);
      expect(atualizados[0]?.parcelaCompraValor).toBe("1200.00");
    });

    /**
     * Fonte sem identificador estável existe — importação de arquivo, por
     * exemplo. Ela pode criar Fato, mas não pode anunciar alteração: não há como
     * saber qual linha mudou.
     */
    it("recusa alteração de fonte sem identificador externo", async () => {
      const conta = criarConta({ usuarioId });
      repositorio.contas.set(conta.id, conta);

      await expect(
        motor.atualizar_fatos_da_fonte([evento({ contaId: conta.id, idExterno: null })], contexto()),
      ).rejects.toThrow(ErroValidacaoFinanceira);
    });

    describe("remoção anunciada pela instituição", () => {
      function remocao() {
        return {
          workspaceId: WORKSPACE,
          fonte: "open_finance" as const,
          provedor: "provedor_teste",
          idExterno: "tx-1",
        };
      }

      /** Desaparecimento registrado: a linha fica; saldo institucional não deriva do Fato. */
      it("cancela o movimento sem apagar a linha nem mexer no saldo_atual", async () => {
        const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
        repositorio.contas.set(conta.id, conta);
        await ingerir(conta.id);

        const { removidos } = await motor.remover_fatos_da_fonte([remocao()], contexto());

        expect(removidos[0]?.status).toBe("cancelado");
        expect(removidos[0]?.statusFonte).toBe("removido");
        expect(repositorio.movimentos.size).toBe(1);
        expect(Number(repositorio.contas.get(conta.id)?.saldoAtual)).toBe(1000);
      });

      it("preserva o Conhecimento da linha removida", async () => {
        const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
        repositorio.contas.set(conta.id, conta);
        const criado = await ingerir(conta.id);
        repositorio.movimentos.set(criado.id, {
          ...criado,
          descricao: "Compras do mês",
          observacoes: "dividido com a Ana",
        });

        const { removidos } = await motor.remover_fatos_da_fonte([remocao()], contexto());

        expect(removidos[0]?.descricao).toBe("Compras do mês");
        expect(removidos[0]?.observacoes).toBe("dividido com a Ana");
      });

      /** O provedor retenta até nove vezes: devolver saldo duas vezes seria grave. */
      it("é idempotente: reprocessar não devolve o saldo de novo", async () => {
        const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
        repositorio.contas.set(conta.id, conta);
        await ingerir(conta.id);

        await motor.remover_fatos_da_fonte([remocao()], contexto());
        const segunda = await motor.remover_fatos_da_fonte([remocao()], contexto());

        expect(segunda.jaRemovidos).toBe(1);
        expect(segunda.removidos).toHaveLength(0);
        expect(Number(repositorio.contas.get(conta.id)?.saldoAtual)).toBe(1000);
      });

      /** Já cancelado significa saldo já devolvido: devolver de novo desfaz a conta. */
      it("não devolve saldo de movimento que já estava cancelado", async () => {
        const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
        repositorio.contas.set(conta.id, conta);
        const criado = await ingerir(conta.id);
        repositorio.movimentos.set(criado.id, { ...criado, status: "cancelado" });
        repositorio.contas.set(conta.id, { ...conta, saldoAtual: "1000.00" });

        await motor.remover_fatos_da_fonte([remocao()], contexto());

        expect(Number(repositorio.contas.get(conta.id)?.saldoAtual)).toBe(1000);
        expect(repositorio.movimentos.get(criado.id)?.statusFonte).toBe("removido");
      });

      it("não devolve saldo de movimento que ainda era previsto", async () => {
        const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
        repositorio.contas.set(conta.id, conta);
        await ingerir(conta.id, { statusFonte: "pendente" });

        await motor.remover_fatos_da_fonte([remocao()], contexto());

        expect(Number(repositorio.contas.get(conta.id)?.saldoAtual)).toBe(1000);
      });

      it("ignora remoção do que nunca foi ingerido", async () => {
        const resultado = await motor.remover_fatos_da_fonte([remocao()], contexto());

        expect(resultado.desconhecidos).toBe(1);
        expect(resultado.removidos).toHaveLength(0);
      });

      it("registra o cancelamento na auditoria", async () => {
        const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
        repositorio.contas.set(conta.id, conta);
        await ingerir(conta.id);

        await motor.remover_fatos_da_fonte([remocao()], contexto());

        const auditoria = repositorio.auditorias.at(-1);
        expect(auditoria?.acao).toBe("CANCELAMENTO");
        expect((auditoria?.estadoAnterior as { status?: string })?.status).toBe("realizado");
        expect((auditoria?.estadoAtual as { statusFonte?: string })?.statusFonte).toBe("removido");
      });
    });
  });

  describe("política de conta sincronizada", () => {
    /** Campos comuns de um lançamento manual simples, para não repetir em cada caso. */
    function despesa(sobrepor: Partial<EntradaCriarMovimento> = {}) {
      return {
        descricao: "Almoço",
        valor: 45,
        tipo: "despesa" as const,
        status: "realizado" as const,
        perfil: "pf" as const,
        dataMovimento: "2026-08-01",
        categoriaId: categoria.id,
        usuarioId,
        criadoPor: usuarioId,
        ...sobrepor,
      };
    }

    it("recusa lançamento em conta conectada ao banco", async () => {
      const conta = criarConta({ usuarioId, nome: "Nubank", sincronizada: true });
      repositorio.contas.set(conta.id, conta);

      await expect(criar_movimento(despesa({ contaId: conta.id }))).rejects.toThrow(
        ErroContaSincronizada,
      );
      expect(repositorio.movimentos.size).toBe(0);
    });

    it("explica na recusa o que ainda dá para fazer", async () => {
      const conta = criarConta({ usuarioId, nome: "Nubank", sincronizada: true });
      repositorio.contas.set(conta.id, conta);

      const erro = await criar_movimento(despesa({ contaId: conta.id })).catch((e) => e);

      expect(erro.message).toContain("Nubank");
      expect(erro.message).toContain("conectada ao banco");
      expect(erro.message).toContain("classifico");
    });

    it("recusa compra no crédito de cartão sincronizado", async () => {
      const conta = criarConta({ usuarioId });
      const cartao = criarCartao(conta.id, { usuarioId, nome: "Inter", sincronizada: true });
      repositorio.contas.set(conta.id, conta);
      repositorio.cartoes.set(cartao.id, cartao);

      await expect(
        criar_movimento(despesa({ cartaoId: cartao.id, formaPagamento: "credito" })),
      ).rejects.toThrow(ErroContaSincronizada);
    });

    it("recusa débito quando a conta vinculada é sincronizada, mesmo com o cartão livre", async () => {
      const conta = criarConta({ usuarioId, nome: "C6", sincronizada: true });
      const cartao = criarCartao(conta.id, { usuarioId, modalidade: "multiplo", sincronizada: false });
      repositorio.contas.set(conta.id, conta);
      repositorio.cartoes.set(cartao.id, cartao);

      const erro = await criar_movimento(
        despesa({ cartaoId: cartao.id, formaPagamento: "debito" }),
      ).catch((e) => e);

      expect(erro).toBeInstanceOf(ErroContaSincronizada);
      expect(erro.message).toContain("C6");
    });

    it("recusa transferência quando qualquer uma das pontas é sincronizada", async () => {
      const origem = criarConta({ usuarioId, nome: "Origem" });
      const destino = criarConta({ usuarioId, nome: "Destino", sincronizada: true });
      repositorio.contas.set(origem.id, origem);
      repositorio.contas.set(destino.id, destino);

      await expect(
        criar_movimento(
          despesa({ tipo: "transferencia", contaId: origem.id, contaDestinoId: destino.id }),
        ),
      ).rejects.toThrow(ErroContaSincronizada);
    });

    it("recusa corrigir o Fato de um lançamento manual que ficou em conta sincronizada", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
      repositorio.contas.set(conta.id, conta);

      const resultado = await criar_movimento(despesa({ contaId: conta.id }));

      // A conta foi conectada ao banco depois do lançamento — situação real de
      // quem usava o WhatsApp antes de existir Open Finance.
      repositorio.contas.set(conta.id, { ...conta, sincronizada: true });

      await expect(
        motor.corrigir_fato_manual({
          movimentoId: resultado.movimentos[0]!.id,
          alteradoPor: usuarioId,
          campos: { valor: 60 },
        }),
      ).rejects.toThrow(ErroContaSincronizada);
    });

    it("recusa cancelar um lançamento em conta sincronizada", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
      repositorio.contas.set(conta.id, conta);

      const resultado = await criar_movimento(despesa({ contaId: conta.id }));
      repositorio.contas.set(conta.id, { ...conta, sincronizada: true });

      const erro = await motor
        .corrigir_fato_manual({
          movimentoId: resultado.movimentos[0]!.id,
          alteradoPor: usuarioId,
          campos: { status: "cancelado" },
        })
        .catch((e) => e);

      expect(erro).toBeInstanceOf(ErroContaSincronizada);
      expect(erro.message).toContain("não entrar nos relatórios");
    });

    it("cancela manual por conciliação mesmo com conta sincronizada", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "1000.00" });
      repositorio.contas.set(conta.id, conta);

      const criado = await criar_movimento(despesa({ contaId: conta.id, valor: 45 }));
      const manual = criado.movimentos[0]!;
      repositorio.contas.set(conta.id, { ...conta, sincronizada: true });

      const { criados } = await motor.ingerir_eventos(
        [
          {
            workspaceId: WORKSPACE,
            fonte: "open_finance",
            provedor: "provedor_teste",
            idExterno: "tx-conciliar",
            ocorridoEm: "2026-08-01",
            valor: 45,
            tipo: "despesa",
            descricaoFonte: "IFOOD *123",
            statusFonte: "confirmado",
            fatoImutavel: true,
            contaId: conta.id,
          },
        ],
        {
          usuarioId,
          criadoPor: usuarioId,
          categoriaIdNaoClassificado: categoria.id,
          perfilPadrao: "pf",
        },
      );

      const fato = criados[0]!;
      const { manual: cancelado } = await motor.cancelar_para_conciliacao({
        manualId: manual.id,
        fatoId: fato.id,
        alteradoPor: usuarioId,
      });

      expect(cancelado.status).toBe("cancelado");
      expect(repositorio.movimentos.get(fato.id)?.status).toBe("realizado");
      // Manual cancelado devolve o efeito dele; o Fato do banco permanece no saldo.
      const ativos = [...repositorio.movimentos.values()].filter(
        (m) => m.contaId === conta.id && m.status !== "cancelado" && m.tipo === "despesa",
      );
      expect(ativos).toHaveLength(1);
      expect(ativos[0]?.fonte).toBe("open_finance");
    });

    it("deixa a ingestão gravar Fato na conta sincronizada", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "1000.00", sincronizada: true });
      repositorio.contas.set(conta.id, conta);

      const { criados } = await motor.ingerir_eventos(
        [
          {
            workspaceId: WORKSPACE,
            fonte: "open_finance",
            provedor: "provedor_teste",
            idExterno: "tx-sync",
            ocorridoEm: "2026-08-01",
            valor: 90,
            tipo: "despesa",
            descricaoFonte: "COMPRA MERCADO XY",
            statusFonte: "confirmado",
            fatoImutavel: true,
            contaId: conta.id,
          },
        ],
        {
          usuarioId,
          criadoPor: usuarioId,
          categoriaIdNaoClassificado: categoria.id,
          perfilPadrao: "pf",
        },
      );

      expect(criados).toHaveLength(1);
    });

    it("não muda nada em conta não sincronizada", async () => {
      const conta = criarConta({ usuarioId, saldoAtual: "1000.00", sincronizada: false });
      repositorio.contas.set(conta.id, conta);

      const resultado = await criar_movimento(despesa({ contaId: conta.id }));

      expect(resultado.movimentos).toHaveLength(1);
      expect(Number(repositorio.contas.get(conta.id)?.saldoAtual)).toBe(955);
    });
  });
});
