import { describe, expect, it } from "vitest";
import {
  agregar_gasto_cartao_por_competencia,
  agregar_totais_por_natureza,
  filtrar_movimentos_por_natureza,
  montar_fluxo_caixa,
  montar_proximos_pagamentos,
  perfil_de_tipo_gasto_dashboard,
  type DashboardCartao,
} from "../servicos/montar-dashboard";

const cartao: DashboardCartao = {
  id: "cartao-mp",
  nome: "Mercado Pago Visa",
  perfil: "pj",
  limite: 5000,
  comprometido: 800,
  disponivel: 4200,
  fechamento: 10,
  vencimento: 17,
  sincronizada: true,
  instituicao: "Mercado Pago",
  final4: "1234",
  gastoMes: 320,
  quantidadeLancamentos: 4,
};

describe("montar_proximos_pagamentos", () => {
  it("marca a fatura como paga quando há pagamento ligado àquele cartão e vencimento", () => {
    const itens = montar_proximos_pagamentos({
      futuro: [],
      cartoes: [cartao],
      movimentos: [],
      pagamentosFatura: [
        {
          status: "realizado",
          papel: "pagamento_fatura",
          cartaoFaturaId: "cartao-mp",
          competenciaFatura: "2026-08",
        },
      ],
      hoje: "2026-08-21",
      periodo: { de: "2026-08-01", ate: "2026-08-31" },
    });
    expect(itens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          descricao: "Fatura Mercado Pago Visa",
          origem: "fatura",
          data: "2026-08-17",
          pago: true,
          vencida: false,
        }),
      ]),
    );
  });

  it("coloca fatura paga depois das que ainda estão em aberto", () => {
    const outro: DashboardCartao = { ...cartao, id: "cartao-nu", nome: "Nu", vencimento: 10, gastoMes: 100 };
    const itens = montar_proximos_pagamentos({
      futuro: [],
      cartoes: [cartao, outro],
      movimentos: [],
      pagamentosFatura: [
        {
          status: "realizado",
          papel: "pagamento_fatura",
          cartaoFaturaId: "cartao-mp",
          competenciaFatura: "2026-08",
        },
      ],
      hoje: "2026-08-21",
      periodo: { de: "2026-08-01", ate: "2026-08-31" },
    });
    const faturas = itens.filter((item) => item.origem === "fatura");
    expect(faturas.map((item) => item.pago)).toEqual([false, true]);
  });

  it("não lista parcela nem previsto do cartão quando a fatura do ciclo está paga", () => {
    const itens = montar_proximos_pagamentos({
      futuro: [
        {
          descricao: "GOL LINHAS (parcela 5)",
          valor: 104,
          data: "2026-08-01",
          origem: "parcela",
          cartaoId: "cartao-mp",
        },
      ],
      cartoes: [cartao],
      movimentos: [
        {
          id: "ifood",
          descricao: "IFD*BUFFET",
          valor: 79.18,
          status: "previsto",
          dataMovimento: "2026-08-01",
          fonte: "open_finance",
          tipo: "despesa",
          cartaoId: "cartao-mp",
        },
      ],
      pagamentosFatura: [
        {
          status: "realizado",
          papel: "pagamento_fatura",
          cartaoFaturaId: "cartao-mp",
          competenciaFatura: "2026-08",
        },
      ],
      hoje: "2026-08-21",
      periodo: { de: "2026-08-01", ate: "2026-08-31" },
    });
    expect(itens.some((item) => item.descricao.includes("GOL"))).toBe(false);
    expect(itens.some((item) => item.descricao.includes("IFD"))).toBe(false);
    expect(itens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ origem: "fatura", pago: true, vencida: false }),
      ]),
    );
  });

  it("não trata compra do cartão como vencida se a fatura do mês já cobre o ciclo", () => {
    const itens = montar_proximos_pagamentos({
      futuro: [
        {
          descricao: "HOTEL (parcela 4)",
          valor: 311.4,
          data: "2026-08-01",
          origem: "parcela",
          cartaoId: "cartao-mp",
        },
      ],
      cartoes: [cartao],
      movimentos: [],
      hoje: "2026-08-21",
      periodo: { de: "2026-08-01", ate: "2026-08-31" },
    });
    expect(itens.some((item) => item.descricao.includes("HOTEL"))).toBe(false);
    expect(itens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ origem: "fatura", descricao: "Fatura Mercado Pago Visa" }),
      ]),
    );
  });

  it("mantém previsto de conta vencido — não é fatura de cartão", () => {
    const itens = montar_proximos_pagamentos({
      futuro: [],
      cartoes: [cartao],
      movimentos: [
        {
          id: "aluguel",
          descricao: "Aluguel",
          valor: 1500,
          status: "previsto",
          dataMovimento: "2026-08-05",
          fonte: "manual",
          tipo: "despesa",
          cartaoId: null,
        },
      ],
      hoje: "2026-08-21",
      periodo: { de: "2026-08-01", ate: "2026-08-31" },
    });
    expect(itens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ descricao: "Aluguel", vencida: true, pago: false }),
      ]),
    );
  });

  it("mantém a fatura se o pagamento for de outro mês de vencimento", () => {
    const itens = montar_proximos_pagamentos({
      futuro: [],
      cartoes: [cartao],
      movimentos: [],
      pagamentosFatura: [
        {
          status: "realizado",
          papel: "pagamento_fatura",
          cartaoFaturaId: "cartao-mp",
          competenciaFatura: "2026-07",
        },
      ],
      hoje: "2026-08-21",
      periodo: { de: "2026-08-01", ate: "2026-08-31" },
    });
    expect(itens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          descricao: "Fatura Mercado Pago Visa",
          origem: "fatura",
          data: "2026-08-17",
          pago: false,
          vencida: true,
        }),
      ]),
    );
  });

  it("compra depois do fechamento não aparece em aberto no mês da fatura já paga", () => {
    const mp: DashboardCartao = { ...cartao, fechamento: 12, gastoMes: 0 };
    const itens = montar_proximos_pagamentos({
      futuro: [],
      cartoes: [mp],
      movimentos: [
        {
          id: "agencias",
          descricao: "E AGENCIAS*619063",
          valor: 970.76,
          status: "previsto",
          dataMovimento: "2026-08-25",
          fonte: "open_finance",
          tipo: "despesa",
          cartaoId: "cartao-mp",
        },
      ],
      pagamentosFatura: [
        {
          status: "realizado",
          papel: "pagamento_fatura",
          cartaoFaturaId: "cartao-mp",
          competenciaFatura: "2026-08",
        },
      ],
      hoje: "2026-08-27",
      periodo: { de: "2026-08-01", ate: "2026-08-31" },
    });
    expect(itens.some((item) => item.descricao.includes("619063"))).toBe(false);
    expect(itens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ origem: "fatura", pago: true, vencida: false }),
      ]),
    );
  });

  it("lista cada Pix da competência com vencimento e dia do pagamento", () => {
    const azul: DashboardCartao = {
      ...cartao,
      id: "cartao-azul",
      nome: "Azul Itaú Visa Platinum",
      fechamento: 30,
      vencimento: 6,
      gastoMes: 6500.57,
    };
    const pagamentos = [
      {
        id: "pix-antecipado",
        status: "realizado",
        papel: "pagamento_fatura" as const,
        cartaoFaturaId: "cartao-azul",
        competenciaFatura: "2026-08",
        dataMovimento: "2026-07-29",
        valor: 6500.57,
        tipo: "despesa",
        contaId: "conta",
        cartaoId: null,
        descricao: "Pix fatura",
      },
      {
        id: "pix-sobra",
        status: "realizado",
        papel: "pagamento_fatura" as const,
        cartaoFaturaId: "cartao-azul",
        competenciaFatura: "2026-08",
        dataMovimento: "2026-08-05",
        valor: 11.02,
        tipo: "despesa",
        contaId: "conta",
        cartaoId: null,
        descricao: "Pix sobra",
      },
      {
        id: "credito-cartao",
        status: "realizado",
        papel: "pagamento_fatura" as const,
        cartaoFaturaId: "cartao-azul",
        competenciaFatura: "2026-08",
        dataMovimento: "2026-07-29",
        valor: 6500.57,
        tipo: "receita",
        contaId: null,
        cartaoId: "cartao-azul",
        descricao: "Pagamento recebido",
      },
    ];
    const agosto = montar_proximos_pagamentos({
      futuro: [],
      cartoes: [azul],
      movimentos: [],
      pagamentosFatura: pagamentos,
      hoje: "2026-08-21",
      periodo: { de: "2026-08-01", ate: "2026-08-31" },
    });
    const faturasAgo = agosto.filter((item) => item.origem === "fatura");
    expect(faturasAgo).toEqual([
      expect.objectContaining({
        data: "2026-08-06",
        dataPagamento: "2026-07-29",
        valor: 6500.57,
        pago: true,
        vencida: false,
      }),
      expect.objectContaining({
        data: "2026-08-06",
        dataPagamento: "2026-08-05",
        valor: 11.02,
        pago: true,
        vencida: false,
      }),
    ]);
    expect(faturasAgo).toHaveLength(2);

    const setembro = montar_proximos_pagamentos({
      futuro: [],
      cartoes: [{ ...azul, gastoMes: 80 }],
      movimentos: [],
      pagamentosFatura: pagamentos,
      hoje: "2026-09-10",
      periodo: { de: "2026-09-01", ate: "2026-09-30" },
    });
    expect(setembro.filter((item) => item.origem === "fatura")).toEqual([
      expect.objectContaining({
        data: "2026-09-06",
        pago: false,
        valor: 80,
      }),
    ]);
  });
});

describe("natureza do dashboard", () => {
  it("mapeia query pessoal/empresa para pf/pj e ignora o resto", () => {
    expect(perfil_de_tipo_gasto_dashboard("pessoal")).toBe("pf");
    expect(perfil_de_tipo_gasto_dashboard("pf")).toBe("pf");
    expect(perfil_de_tipo_gasto_dashboard("empresa")).toBe("pj");
    expect(perfil_de_tipo_gasto_dashboard("pj")).toBe("pj");
    expect(perfil_de_tipo_gasto_dashboard(undefined)).toBeUndefined();
    expect(perfil_de_tipo_gasto_dashboard("todos")).toBeUndefined();
  });

  it("pessoal inclui gasto pf em conta pj e exclui gasto pj em conta pf", () => {
    const churrascoNaEmpresa = {
      id: "churrasco",
      tipo: "despesa",
      tipoGasto: "pf",
      valor: "100",
      contaPerfil: "pj",
    };
    const passagemNoPessoal = {
      id: "passagem",
      tipo: "despesa",
      tipoGasto: "pj",
      valor: "2300",
      contaPerfil: "pf",
    };
    const mercadoNaPessoal = {
      id: "mercado",
      tipo: "despesa",
      tipoGasto: "pf",
      valor: "80",
      contaPerfil: "pf",
    };

    const pessoal = filtrar_movimentos_por_natureza(
      [churrascoNaEmpresa, passagemNoPessoal, mercadoNaPessoal],
      "pf",
    );
    expect(pessoal.map((item) => item.id)).toEqual(["churrasco", "mercado"]);

    const empresa = filtrar_movimentos_por_natureza(
      [churrascoNaEmpresa, passagemNoPessoal, mercadoNaPessoal],
      "pj",
    );
    expect(empresa.map((item) => item.id)).toEqual(["passagem"]);
  });

  it("agrega totais pessoais e da empresa no mesmo mês", () => {
    const totais = agregar_totais_por_natureza([
      { tipo: "despesa", valor: "100", tipoGasto: "pf" },
      { tipo: "despesa", valor: "50", tipoGasto: "pj" },
      { tipo: "receita", valor: "3000", tipoGasto: "pf" },
      { tipo: "retirada", valor: "10", tipoGasto: "pf" },
    ]);
    expect(totais.pessoal).toEqual({ receitas: 3000, despesas: 100, resultado: 2900 });
    expect(totais.empresa).toEqual({ receitas: 0, despesas: 50, resultado: -50 });
  });
});

describe("contrato dashboard", () => {
  it("expõe campos esperados pelo web (KPIs superiores + cartões do mês)", () => {
    const amostra = {
      mes: "2026-08",
      periodo: { de: "2026-08-01", ate: "2026-08-31" },
      resumo: {
        saldoTotal: 1000,
        quantidadeContas: 2,
        cartoesUsado: 450,
        cartoesDisponivel: 1550,
        cartoesLimite: 2000,
        quantidadeCartoes: 1,
        percentualUtilizadoCartoes: 22.5,
        gastoCartoesMes: 320,
        quantidadeLancamentosCartoesMes: 4,
        receitasMes: 500,
        despesasMes: 200,
        resultadoMes: 300,
        saldoPeriodo: 300,
      },
      naoClassificado: { quantidade: 0, total: 0 },
      gastosPorCategoria: [{ categoriaNome: "Alimentação", total: 120 }],
      fluxoSaldo: [{ data: "2026-08-01", saldo: 900 }],
      recentes: [],
      contas: [],
      cartoes: [
        {
          id: "c1",
          nome: "Azul",
          perfil: "pf",
          limite: 2000,
          comprometido: 450,
          disponivel: 1550,
          fechamento: 10,
          vencimento: 17,
          sincronizada: true,
          instituicao: "Itaú",
          final4: "1234",
          gastoMes: 320,
          quantidadeLancamentos: 4,
        },
      ],
    };

    expect(amostra.resumo.resultadoMes).toBe(300);
    expect(amostra.resumo.gastoCartoesMes).toBe(320);
    expect(amostra.resumo.quantidadeCartoes).toBe(1);
    expect(amostra.cartoes[0]?.gastoMes).toBe(320);
    expect(amostra.gastosPorCategoria[0]?.categoriaNome).toBe("Alimentação");
  });
});

describe("montar_fluxo_caixa", () => {
  const periodo = { de: "2026-08-01", ate: "2026-08-31" };

  it("termina no saldo atual e inclui Pix de fatura da conta", () => {
    const pontos = montar_fluxo_caixa({
      saldoAtual: 100,
      hoje: "2026-08-21",
      periodo,
      movimentos: [
        {
          dataMovimento: "2026-08-10",
          tipo: "receita",
          valor: 40,
          status: "realizado",
          contaId: "conta",
        },
        {
          dataMovimento: "2026-08-12",
          tipo: "despesa",
          valor: 20,
          status: "realizado",
          contaId: "conta",
        },
        {
          dataMovimento: "2026-08-15",
          tipo: "despesa",
          valor: 50,
          status: "realizado",
          cartaoId: "cartao",
        },
      ],
    });
    expect(pontos[8]?.saldo).toBe(80);
    expect(pontos[9]?.saldo).toBe(120);
    expect(pontos[11]?.saldo).toBe(100);
    expect(pontos[20]?.saldo).toBe(100);
    expect(pontos.at(-1)?.saldo).toBe(100);
  });

  it("no mês passado, desconta o caixa de depois para achar o saldo do fim", () => {
    const pontos = montar_fluxo_caixa({
      saldoAtual: 100,
      hoje: "2026-08-21",
      periodo: { de: "2026-07-01", ate: "2026-07-31" },
      movimentos: [
        {
          dataMovimento: "2026-07-10",
          tipo: "receita",
          valor: 40,
          status: "realizado",
          contaId: "conta",
        },
        {
          dataMovimento: "2026-08-05",
          tipo: "despesa",
          valor: 10,
          status: "realizado",
          contaId: "conta",
        },
      ],
    });
    expect(pontos[0]?.saldo).toBe(70);
    expect(pontos[9]?.saldo).toBe(110);
    expect(pontos.at(-1)?.saldo).toBe(110);
  });
});

describe("agregar_gasto_cartao_por_competencia", () => {
  it("agosto ignora compra pós-fechamento; setembro inclui", () => {
    const fechamento = new Map([["cartao-mp", 12]]);
    const movimentos = [
      {
        tipo: "despesa",
        valor: "970.76",
        dataMovimento: "2026-08-25",
        cartaoId: "cartao-mp",
      },
      {
        tipo: "despesa",
        valor: "80",
        dataMovimento: "2026-08-10",
        cartaoId: "cartao-mp",
      },
    ];
    const agosto = agregar_gasto_cartao_por_competencia(movimentos, fechamento, "2026-08");
    const setembro = agregar_gasto_cartao_por_competencia(movimentos, fechamento, "2026-09");
    expect(agosto.get("cartao-mp")).toEqual({ gasto: 80, quantidade: 1 });
    expect(setembro.get("cartao-mp")).toEqual({ gasto: 970.76, quantidade: 1 });
  });
});
