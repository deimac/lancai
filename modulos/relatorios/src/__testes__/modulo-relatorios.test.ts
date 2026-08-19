import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Cartao, Categoria, Conta, Movimento, Parcela } from "@lancai/banco";
import type { FiltrosVisaoResolvidos } from "@lancai/tipos";
import { ModuloRelatorios } from "../modulo-relatorios";
import { RepositorioRelatoriosMemoria } from "../repositorio-relatorios-memoria";
import type {
  ResultadoCartoes,
  ResultadoCategoria,
  ResultadoEvolucao,
  ResultadoFluxo,
  ResultadoFuturo,
  ResultadoHistorico,
  ResultadoParcelamentos,
  ResultadoSaldos,
} from "../tipos-resultado";

const DATA_ATUAL = "2026-08-15";
const WORKSPACE = "00000000-0000-4000-8000-000000000001";

function criarConta(usuarioId: string, sobrepor: Partial<Conta> = {}): Conta {
  const agora = new Date();
  return {
    id: randomUUID(),
    nome: "Nubank",
    saldoInicial: "0.00",
    saldoAtual: "1000.00",
    perfil: "pf",
    ativo: true,
    sincronizada: false,
    usuarioId,
    workspaceId: WORKSPACE,
    dataCriacao: agora,
    dataAtualizacao: agora,
    contaFinanceiraId: null,
    ...sobrepor,
  };
}

function criarCartao(usuarioId: string, contaId: string, sobrepor: Partial<Cartao> = {}): Cartao {
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
    usuarioId,
    workspaceId: WORKSPACE,
    dataCriacao: agora,
    dataAtualizacao: agora,
    contaFinanceiraId: null,
    ...sobrepor,
  };
}

function criarCategoria(usuarioId: string, sobrepor: Partial<Categoria> = {}): Categoria {
  const agora = new Date();
  return {
    id: randomUUID(),
    nome: "Combustível",
    tipo: "despesa",
    ativo: true,
    usuarioId,
    workspaceId: WORKSPACE,
    dataCriacao: agora,
    dataAtualizacao: agora,
    ...sobrepor,
  };
}

function criarMovimento(usuarioId: string, categoriaId: string, sobrepor: Partial<Movimento> = {}): Movimento {
  const agora = new Date();
  return {
    id: randomUUID(),
    workspaceId: WORKSPACE,
    fonte: "manual",
    provedor: null,
    idExterno: null,
    fingerprint: null,
    descricaoFonte: "Movimento de teste",
    favorecidoFonte: null,
    statusFonte: "confirmado",
    parcelaNumero: null,
    parcelaTotal: null,
    parcelaCompraEm: null,
    parcelaCompraValor: null,
    descricao: "Movimento de teste",
    valor: "100.00",
    tipo: "despesa",
    status: "realizado",
    tipoGasto: "pf",
    formaPagamento: null,
    dataMovimento: DATA_ATUAL,
    dataLancamento: agora,
    contaId: null,
    cartaoId: null,
    categoriaId,
    pessoaId: null,
    tags: [],
    observacoes: null,
    classificadoPor: "usuario",
    regraId: null,
    classificadoEm: null,
    confiancaIa: null,
    ignoradoEmRelatorio: false,
    usuarioId,
    dataCriacao: agora,
    dataAtualizacao: agora,
    criadoPor: usuarioId,
    alteradoPor: null,
    ...sobrepor,
  };
}

function criarParcela(movimentoId: string, sobrepor: Partial<Parcela> = {}): Parcela {
  const agora = new Date();
  return {
    id: randomUUID(),
    movimentoId,
    numeroParcela: 1,
    valor: "100.00",
    dataMovimento: DATA_ATUAL,
    status: "previsto",
    dataCriacao: agora,
    dataAtualizacao: agora,
    ...sobrepor,
  };
}

function filtrosBase(usuarioId: string, sobrepor: Partial<FiltrosVisaoResolvidos> = {}): FiltrosVisaoResolvidos {
  return { usuarioId, ...sobrepor };
}

describe("ModuloRelatorios", () => {
  let repositorio: RepositorioRelatoriosMemoria;
  let relatorios: ModuloRelatorios;
  let usuarioId: string;
  let categoria: Categoria;

  beforeEach(() => {
    repositorio = new RepositorioRelatoriosMemoria();
    relatorios = new ModuloRelatorios(repositorio);
    usuarioId = randomUUID();
    categoria = criarCategoria(usuarioId);
    repositorio.categorias.set(categoria.id, categoria);
  });

  describe("saldos", () => {
    it("soma os saldos de todas as contas ativas do usuário", async () => {
      const contaPf = criarConta(usuarioId, { nome: "Nubank", perfil: "pf", saldoAtual: "1000.00" });
      const contaPj = criarConta(usuarioId, { nome: "Inter PJ", perfil: "pj", saldoAtual: "16750.59" });
      repositorio.contas.set(contaPf.id, contaPf);
      repositorio.contas.set(contaPj.id, contaPj);

      const resultado = await relatorios.consultar_visao("saldos", filtrosBase(usuarioId), DATA_ATUAL);

      expect(resultado.tipo).toBe("saldos");
      const dados = resultado.dados as ResultadoSaldos;
      expect(dados.contas).toHaveLength(2);
      expect(dados.totalGeral).toBe(17750.59);
    });

    it("filtra por perfil quando o usuário pergunta especificamente pela conta da empresa", async () => {
      const contaPf = criarConta(usuarioId, { nome: "Nubank", perfil: "pf", saldoAtual: "1000.00" });
      const contaPj = criarConta(usuarioId, { nome: "Inter PJ", perfil: "pj", saldoAtual: "16750.59" });
      repositorio.contas.set(contaPf.id, contaPf);
      repositorio.contas.set(contaPj.id, contaPj);

      const resultado = await relatorios.consultar_visao("saldos", filtrosBase(usuarioId, { perfil: "pj" }), DATA_ATUAL);

      const dados = resultado.dados as ResultadoSaldos;
      expect(dados.contas).toEqual([{ nome: "Inter PJ", perfil: "pj", saldoAtual: 16750.59 }]);
      expect(dados.totalGeral).toBe(16750.59);
    });

    it("devolve zero quando o usuário não tem nenhuma conta", async () => {
      const resultado = await relatorios.consultar_visao("saldos", filtrosBase(usuarioId), DATA_ATUAL);
      const dados = resultado.dados as ResultadoSaldos;
      expect(dados.contas).toEqual([]);
      expect(dados.totalGeral).toBe(0);
    });
  });

  describe("cartoes", () => {
    it("calcula o limite disponível a partir das parcelas em aberto (cartão manual)", async () => {
      const conta = criarConta(usuarioId);
      const cartao = criarCartao(usuarioId, conta.id, { limite: "5000.00" });
      repositorio.contas.set(conta.id, conta);
      repositorio.cartoes.set(cartao.id, cartao);

      const movimento = criarMovimento(usuarioId, categoria.id, { cartaoId: cartao.id, valor: "1500.00" });
      repositorio.movimentos.set(movimento.id, movimento);
      repositorio.parcelas.set(randomUUID(), criarParcela(movimento.id, { valor: "750.00", numeroParcela: 1 }));
      repositorio.parcelas.set(randomUUID(), criarParcela(movimento.id, { valor: "750.00", numeroParcela: 2 }));

      const resultado = await relatorios.consultar_visao("cartoes", filtrosBase(usuarioId), DATA_ATUAL);
      const dados = resultado.dados as ResultadoCartoes;

      expect(dados.cartoes).toHaveLength(1);
      expect(dados.cartoes[0]).toMatchObject({
        nome: "Inter Black",
        limite: 5000,
        comprometido: 1500,
        disponivel: 3500,
        sincronizada: false,
      });
    });

    it("no cartão Open Finance usa o saldo institucional (não soma parcelas)", async () => {
      const conta = criarConta(usuarioId);
      const cartao = criarCartao(usuarioId, conta.id, {
        limite: "20000.00",
        saldo: "16084.40",
        sincronizada: true,
      });
      repositorio.contas.set(conta.id, conta);
      repositorio.cartoes.set(cartao.id, cartao);

      const movimento = criarMovimento(usuarioId, categoria.id, { cartaoId: cartao.id, valor: "1500.00" });
      repositorio.movimentos.set(movimento.id, movimento);
      repositorio.parcelas.set(randomUUID(), criarParcela(movimento.id, { valor: "750.00", numeroParcela: 1 }));
      repositorio.parcelas.set(randomUUID(), criarParcela(movimento.id, { valor: "750.00", numeroParcela: 2 }));

      const resultado = await relatorios.consultar_visao("cartoes", filtrosBase(usuarioId), DATA_ATUAL);
      const dados = resultado.dados as ResultadoCartoes;

      expect(dados.cartoes[0]).toMatchObject({
        limite: 20000,
        comprometido: 16084.4,
        disponivel: 3915.6,
        sincronizada: true,
      });
    });

    it("ignora parcelas canceladas no cálculo do comprometido", async () => {
      const conta = criarConta(usuarioId);
      const cartao = criarCartao(usuarioId, conta.id, { limite: "1000.00" });
      repositorio.contas.set(conta.id, conta);
      repositorio.cartoes.set(cartao.id, cartao);

      const movimento = criarMovimento(usuarioId, categoria.id, { cartaoId: cartao.id, valor: "500.00" });
      repositorio.movimentos.set(movimento.id, movimento);
      repositorio.parcelas.set(randomUUID(), criarParcela(movimento.id, { valor: "500.00", status: "cancelado" }));

      const resultado = await relatorios.consultar_visao("cartoes", filtrosBase(usuarioId), DATA_ATUAL);
      const dados = resultado.dados as ResultadoCartoes;

      expect(dados.cartoes[0]?.comprometido).toBe(0);
      expect(dados.cartoes[0]?.disponivel).toBe(1000);
    });
  });

  describe("parcelamentos", () => {
    it("separa parcelas já vencidas das restantes e soma o valor que falta pagar", async () => {
      const conta = criarConta(usuarioId);
      const cartao = criarCartao(usuarioId, conta.id);
      repositorio.contas.set(conta.id, conta);
      repositorio.cartoes.set(cartao.id, cartao);

      const movimento = criarMovimento(usuarioId, categoria.id, {
        descricao: "Notebook",
        cartaoId: cartao.id,
        valor: "8000.00",
      });
      repositorio.movimentos.set(movimento.id, movimento);

      // 3 parcelas já vencidas (antes de 2026-08-15) e 7 ainda por vencer.
      const datas = [
        "2026-05-27",
        "2026-06-27",
        "2026-07-27",
        "2026-08-27",
        "2026-09-27",
        "2026-10-27",
        "2026-11-27",
        "2026-12-27",
        "2027-01-27",
        "2027-02-27",
      ];
      datas.forEach((data, indice) => {
        repositorio.parcelas.set(
          randomUUID(),
          criarParcela(movimento.id, { numeroParcela: indice + 1, valor: "800.00", dataMovimento: data }),
        );
      });

      const resultado = await relatorios.consultar_visao("parcelamentos", filtrosBase(usuarioId), DATA_ATUAL);
      const dados = resultado.dados as ResultadoParcelamentos;

      expect(dados.compras).toHaveLength(1);
      const compra = dados.compras[0]!;
      expect(compra.descricao).toBe("Notebook");
      expect(compra.valorTotal).toBe(8000);
      expect(compra.parcelasTotais).toBe(10);
      expect(compra.parcelasPagas).toBe(3);
      expect(compra.parcelasRestantes).toBe(7);
      expect(compra.valorRestante).toBe(5600);
      expect(compra.proximaParcelaData).toBe("2026-08-27");
    });

    it("não lista compras à vista (uma única parcela) como parcelamento", async () => {
      const conta = criarConta(usuarioId);
      const cartao = criarCartao(usuarioId, conta.id);
      repositorio.contas.set(conta.id, conta);
      repositorio.cartoes.set(cartao.id, cartao);

      const movimento = criarMovimento(usuarioId, categoria.id, { cartaoId: cartao.id, valor: "45.00" });
      repositorio.movimentos.set(movimento.id, movimento);
      repositorio.parcelas.set(randomUUID(), criarParcela(movimento.id, { valor: "45.00" }));

      const resultado = await relatorios.consultar_visao("parcelamentos", filtrosBase(usuarioId), DATA_ATUAL);
      const dados = resultado.dados as ResultadoParcelamentos;
      expect(dados.compras).toEqual([]);
    });
  });

  describe("categoria", () => {
    it("soma despesas de uma categoria específica dentro do período informado", async () => {
      const dentroPeriodo1 = criarMovimento(usuarioId, categoria.id, { valor: "45.00", dataMovimento: "2026-08-01" });
      const dentroPeriodo2 = criarMovimento(usuarioId, categoria.id, { valor: "80.00", dataMovimento: "2026-08-20" });
      const foraPeriodo = criarMovimento(usuarioId, categoria.id, { valor: "999.00", dataMovimento: "2026-06-01" });
      [dentroPeriodo1, dentroPeriodo2, foraPeriodo].forEach((movimento) => repositorio.movimentos.set(movimento.id, movimento));

      const resultado = await relatorios.consultar_visao(
        "categoria",
        filtrosBase(usuarioId, { categoriaId: categoria.id, periodo: { de: "2026-08-01", ate: "2026-08-31" } }),
        DATA_ATUAL,
      );
      const dados = resultado.dados as ResultadoCategoria;

      expect(dados.categoriaNome).toBe("Combustível");
      expect(dados.totalDespesas).toBe(125);
    });

    it("sem categoria_nome, devolve um ranking das categorias com mais gasto no mês atual", async () => {
      const alimentacao = criarCategoria(usuarioId, { nome: "Alimentação" });
      repositorio.categorias.set(alimentacao.id, alimentacao);

      repositorio.movimentos.set(
        randomUUID(),
        criarMovimento(usuarioId, categoria.id, { valor: "100.00", dataMovimento: "2026-08-05" }),
      );
      repositorio.movimentos.set(
        randomUUID(),
        criarMovimento(usuarioId, alimentacao.id, { valor: "300.00", dataMovimento: "2026-08-10" }),
      );

      const resultado = await relatorios.consultar_visao("categoria", filtrosBase(usuarioId), DATA_ATUAL);
      const dados = resultado.dados as ResultadoCategoria;

      expect(dados.categoriaNome).toBeNull();
      expect(dados.ranking[0]).toEqual({ categoriaNome: "Alimentação", total: 300 });
      expect(dados.totalDespesas).toBe(400);
    });

    it("soma no ranking categorias homônimas de ids diferentes", async () => {
      const naoA = criarCategoria(usuarioId, { nome: "Não classificado" });
      const naoB = criarCategoria(usuarioId, { nome: "Não classificado" });
      repositorio.categorias.set(naoA.id, naoA);
      repositorio.categorias.set(naoB.id, naoB);

      repositorio.movimentos.set(
        randomUUID(),
        criarMovimento(usuarioId, naoA.id, { valor: "100.00", dataMovimento: "2026-08-05" }),
      );
      repositorio.movimentos.set(
        randomUUID(),
        criarMovimento(usuarioId, naoB.id, { valor: "50.00", dataMovimento: "2026-08-06" }),
      );

      const resultado = await relatorios.consultar_visao("categoria", filtrosBase(usuarioId), DATA_ATUAL);
      const dados = resultado.dados as ResultadoCategoria;

      expect(dados.ranking).toEqual([{ categoriaNome: "Não classificado", total: 150 }]);
    });
  });

  describe("futuro", () => {
    it("soma parcelas futuras até o fim do ano, ignorando parcelas do ano seguinte", async () => {
      const conta = criarConta(usuarioId);
      const cartao = criarCartao(usuarioId, conta.id);
      repositorio.contas.set(conta.id, conta);
      repositorio.cartoes.set(cartao.id, cartao);

      const movimento = criarMovimento(usuarioId, categoria.id, { cartaoId: cartao.id, valor: "600.00" });
      repositorio.movimentos.set(movimento.id, movimento);
      repositorio.parcelas.set(randomUUID(), criarParcela(movimento.id, { numeroParcela: 1, valor: "300.00", dataMovimento: "2026-09-27" }));
      repositorio.parcelas.set(randomUUID(), criarParcela(movimento.id, { numeroParcela: 2, valor: "300.00", dataMovimento: "2027-01-27" }));

      const resultado = await relatorios.consultar_visao("futuro", filtrosBase(usuarioId), DATA_ATUAL);
      const dados = resultado.dados as ResultadoFuturo;

      expect(dados.periodo.ate).toBe("2026-12-31");
      expect(dados.totalComprometido).toBe(300);
      expect(dados.itens).toHaveLength(1);
    });
  });

  describe("fluxo", () => {
    it("identifica gasto pessoal pago com conta da empresa", async () => {
      const contaEmpresa = criarConta(usuarioId, { perfil: "pj" });
      repositorio.contas.set(contaEmpresa.id, contaEmpresa);

      repositorio.movimentos.set(
        randomUUID(),
        criarMovimento(usuarioId, categoria.id, {
          descricao: "Churrasco do Marcio",
          tipoGasto: "pf",
          contaId: contaEmpresa.id,
          valor: "100.00",
          dataMovimento: "2026-08-10",
        }),
      );

      const resultado = await relatorios.consultar_visao("fluxo", filtrosBase(usuarioId), DATA_ATUAL);
      const dados = resultado.dados as ResultadoFluxo;

      expect(dados.totalPessoalComEmpresa).toBe(100);
      expect(dados.totalEmpresaComPessoal).toBe(0);
      expect(dados.itens[0]?.direcao).toBe("pessoal_com_empresa");
    });

    it("identifica gasto da empresa pago com cartão pessoal e ignora movimentos sem cruzamento", async () => {
      const contaPf = criarConta(usuarioId, { perfil: "pf" });
      const cartaoPf = criarCartao(usuarioId, contaPf.id, { perfil: "pf" });
      repositorio.contas.set(contaPf.id, contaPf);
      repositorio.cartoes.set(cartaoPf.id, cartaoPf);

      repositorio.movimentos.set(
        randomUUID(),
        criarMovimento(usuarioId, categoria.id, {
          descricao: "Passagem para viagem de negócios",
          tipoGasto: "pj",
          cartaoId: cartaoPf.id,
          valor: "2300.00",
          dataMovimento: "2026-08-10",
        }),
      );
      repositorio.movimentos.set(
        randomUUID(),
        criarMovimento(usuarioId, categoria.id, {
          descricao: "Combustível pessoal normal",
          tipoGasto: "pf",
          contaId: contaPf.id,
          valor: "180.00",
          dataMovimento: "2026-08-11",
        }),
      );

      const resultado = await relatorios.consultar_visao("fluxo", filtrosBase(usuarioId), DATA_ATUAL);
      const dados = resultado.dados as ResultadoFluxo;

      expect(dados.totalEmpresaComPessoal).toBe(2300);
      expect(dados.totalPessoalComEmpresa).toBe(0);
      expect(dados.itens).toHaveLength(1);
    });
  });

  describe("evolucao", () => {
    it("agrupa receitas e despesas por mês no período padrão", async () => {
      repositorio.movimentos.set(
        randomUUID(),
        criarMovimento(usuarioId, categoria.id, { tipo: "despesa", valor: "200.00", dataMovimento: "2026-08-05" }),
      );
      repositorio.movimentos.set(
        randomUUID(),
        criarMovimento(usuarioId, categoria.id, { tipo: "receita", valor: "1000.00", dataMovimento: "2026-08-06" }),
      );
      repositorio.movimentos.set(
        randomUUID(),
        criarMovimento(usuarioId, categoria.id, { tipo: "despesa", valor: "50.00", dataMovimento: "2026-07-10" }),
      );

      const resultado = await relatorios.consultar_visao("evolucao", filtrosBase(usuarioId), DATA_ATUAL);
      const dados = resultado.dados as ResultadoEvolucao;

      const mesAgosto = dados.meses.find((mes) => mes.mes === "2026-08");
      const mesJulho = dados.meses.find((mes) => mes.mes === "2026-07");

      expect(mesAgosto).toEqual({ mes: "2026-08", receitas: 1000, despesas: 200, saldoLiquido: 800 });
      expect(mesJulho).toEqual({ mes: "2026-07", receitas: 0, despesas: 50, saldoLiquido: -50 });
      expect(dados.meses).toHaveLength(6);
    });
  });

  describe("historico", () => {
    it("agrupa por dia com totais e ignora cancelados", async () => {
      const conta = criarConta(usuarioId, { nome: "C6 Bank", perfil: "pf" });
      const cartao = criarCartao(usuarioId, conta.id, { nome: "Nubank" });
      repositorio.contas.set(conta.id, conta);
      repositorio.cartoes.set(cartao.id, cartao);

      repositorio.movimentos.set(
        randomUUID(),
        criarMovimento(usuarioId, categoria.id, {
          descricao: "Almoço",
          tipo: "despesa",
          valor: "45.00",
          dataMovimento: "2026-08-15",
          contaId: conta.id,
          dataLancamento: new Date("2026-08-15T12:00:00Z"),
        }),
      );
      repositorio.movimentos.set(
        randomUUID(),
        criarMovimento(usuarioId, categoria.id, {
          descricao: "Pix João",
          tipo: "receita",
          valor: "2500.00",
          dataMovimento: "2026-08-14",
          contaId: conta.id,
          dataLancamento: new Date("2026-08-14T10:00:00Z"),
        }),
      );
      repositorio.movimentos.set(
        randomUUID(),
        criarMovimento(usuarioId, categoria.id, {
          descricao: "Uber",
          tipo: "despesa",
          valor: "32.00",
          dataMovimento: "2026-08-14",
          cartaoId: cartao.id,
          dataLancamento: new Date("2026-08-14T18:00:00Z"),
        }),
      );
      repositorio.movimentos.set(
        randomUUID(),
        criarMovimento(usuarioId, categoria.id, {
          descricao: "Cancelado",
          tipo: "despesa",
          valor: "999.00",
          status: "cancelado",
          dataMovimento: "2026-08-15",
          contaId: conta.id,
        }),
      );

      const resultado = await relatorios.consultar_visao(
        "historico",
        filtrosBase(usuarioId, { periodo: { de: "2026-08-14", ate: "2026-08-15" } }),
        DATA_ATUAL,
      );
      const dados = resultado.dados as ResultadoHistorico;

      expect(dados.totalItens).toBe(3);
      expect(dados.itensOmitidos).toBe(0);
      expect(dados.totalReceitas).toBe(2500);
      expect(dados.totalDespesas).toBe(77);
      expect(dados.saldoPeriodo).toBe(2423);
      expect(dados.dias.map((dia) => dia.data)).toEqual(["2026-08-15", "2026-08-14"]);
      expect(dados.dias[1]?.itens.map((item) => item.descricao)).toEqual(["Uber", "Pix João"]);
      expect(dados.dias[0]?.itens[0]).toMatchObject({
        id: expect.any(String),
        descricao: "Almoço",
        contaNome: "C6 Bank",
        cartaoNome: null,
      });
    });

    it("parcela OF no histórico soma só a competência e expõe N/M + total", async () => {
      const conta = criarConta(usuarioId, { nome: "MP Conta" });
      repositorio.contas.set(conta.id, conta);
      const cartao = criarCartao(usuarioId, conta.id, { nome: "Mercado Pago" });
      repositorio.cartoes.set(cartao.id, cartao);

      repositorio.movimentos.set(
        randomUUID(),
        criarMovimento(usuarioId, categoria.id, {
          descricao: "E AGENCIAS*416333",
          tipo: "despesa",
          valor: "434.38",
          dataMovimento: "2026-08-10",
          cartaoId: cartao.id,
          parcelaNumero: 1,
          parcelaTotal: 10,
          parcelaCompraEm: "2026-08-10",
          parcelaCompraValor: null,
          status: "previsto",
          fonte: "open_finance",
        }),
      );
      repositorio.movimentos.set(
        randomUUID(),
        criarMovimento(usuarioId, categoria.id, {
          descricao: "E AGENCIAS*416333",
          tipo: "despesa",
          valor: "434.35",
          dataMovimento: "2026-09-01",
          cartaoId: cartao.id,
          parcelaNumero: 2,
          parcelaTotal: 10,
          parcelaCompraEm: "2026-08-10",
          parcelaCompraValor: null,
          status: "previsto",
          fonte: "open_finance",
        }),
      );

      const resultado = await relatorios.consultar_visao(
        "historico",
        filtrosBase(usuarioId, { periodo: { de: "2026-08-10", ate: "2026-08-10" } }),
        DATA_ATUAL,
      );
      const dados = resultado.dados as ResultadoHistorico;

      expect(dados.totalItens).toBe(1);
      expect(dados.totalDespesas).toBe(434.38);
      expect(dados.dias[0]?.itens[0]).toMatchObject({
        descricao: "E AGENCIAS*416333",
        parcelaNumero: 1,
        parcelaTotal: 10,
        parcelaCompraValor: 4343.8,
        cartaoNome: "Mercado Pago",
      });
    });

    it("filtra por descrição/estabelecimento (ex.: Uber)", async () => {
      repositorio.movimentos.set(
        randomUUID(),
        criarMovimento(usuarioId, categoria.id, {
          descricao: "Uber",
          valor: "32.00",
          dataMovimento: "2026-08-10",
        }),
      );
      repositorio.movimentos.set(
        randomUUID(),
        criarMovimento(usuarioId, categoria.id, {
          descricao: "Uber Trip",
          valor: "18.50",
          dataMovimento: "2026-08-12",
        }),
      );
      repositorio.movimentos.set(
        randomUUID(),
        criarMovimento(usuarioId, categoria.id, {
          descricao: "Almoço",
          valor: "45.00",
          dataMovimento: "2026-08-11",
        }),
      );

      const resultado = await relatorios.consultar_visao(
        "historico",
        filtrosBase(usuarioId, {
          descricao: "uber",
          periodo: { de: "2026-08-01", ate: "2026-08-31" },
        }),
        DATA_ATUAL,
      );
      const dados = resultado.dados as ResultadoHistorico;

      expect(dados.totalItens).toBe(2);
      expect(dados.totalDespesas).toBe(50.5);
      expect(dados.dias.flatMap((dia) => dia.itens.map((item) => item.descricao)).sort()).toEqual([
        "Uber",
        "Uber Trip",
      ]);
    });

    it("usa o mês atual quando o período não é informado e corta em 40 itens", async () => {
      const conta = criarConta(usuarioId, { nome: "C6 Bank" });
      repositorio.contas.set(conta.id, conta);

      for (let indice = 1; indice <= 41; indice += 1) {
        const dia = String(Math.min(indice, 28)).padStart(2, "0");
        repositorio.movimentos.set(
          randomUUID(),
          criarMovimento(usuarioId, categoria.id, {
            descricao: `Item ${indice}`,
            valor: "10.00",
            dataMovimento: `2026-08-${dia}`,
            contaId: conta.id,
            dataLancamento: new Date(`2026-08-${dia}T${String(indice % 24).padStart(2, "0")}:00:00Z`),
          }),
        );
      }

      const resultado = await relatorios.consultar_visao("historico", filtrosBase(usuarioId), DATA_ATUAL);
      const dados = resultado.dados as ResultadoHistorico;

      expect(dados.periodo).toEqual({ de: "2026-08-01", ate: "2026-08-31" });
      expect(dados.totalItens).toBe(41);
      expect(dados.itensOmitidos).toBe(1);
      expect(dados.deslocamento).toBe(0);
      expect(dados.dias.reduce((total, dia) => total + dia.itens.length, 0)).toBe(40);

      const pagina2 = await relatorios.consultar_visao(
        "historico",
        filtrosBase(usuarioId),
        DATA_ATUAL,
        { deslocamento: 40 },
      );
      const dados2 = pagina2.dados as ResultadoHistorico;
      expect(dados2.deslocamento).toBe(40);
      expect(dados2.itensOmitidos).toBe(0);
      expect(dados2.dias.reduce((total, dia) => total + dia.itens.length, 0)).toBe(1);
    });

    it("retorna vazio quando não há lançamentos no período", async () => {
      const resultado = await relatorios.consultar_visao(
        "historico",
        filtrosBase(usuarioId, { periodo: { de: "2026-01-01", ate: "2026-01-31" } }),
        DATA_ATUAL,
      );
      const dados = resultado.dados as ResultadoHistorico;

      expect(dados.totalItens).toBe(0);
      expect(dados.dias).toEqual([]);
    });
  });
});
