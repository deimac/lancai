import { describe, expect, it } from "vitest";
import {
  agregar_gasto_cartao_por_competencia,
  agregar_totais_por_natureza,
  filtrar_movimentos_por_natureza,
  mes_gasto_do_cartao,
  filtrar_movimentos_do_resultado,
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

function credito_quitacao(overrides: Record<string, unknown> = {}) {
  return {
    status: "realizado",
    papel: "pagamento_fatura",
    competenciaFatura: "2026-08",
    tipo: "receita",
    cartaoId: "cartao-mp",
    contaId: null,
    descricao: "Pagamento recebido",
    dataMovimento: "2026-08-10",
    valor: 320,
    ...overrides,
  };
}

describe("montar_proximos_pagamentos", () => {
  it("marca a fatura como paga quando o cartão recebeu crédito de quitação no mês", () => {
    const itens = montar_proximos_pagamentos({
      futuro: [],
      cartoes: [cartao],
      movimentos: [],
      pagamentosFatura: [credito_quitacao()],
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
      pagamentosFatura: [credito_quitacao()],
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
      pagamentosFatura: [credito_quitacao()],
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
      pagamentosFatura: [credito_quitacao({ competenciaFatura: "2026-07" })],
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
      pagamentosFatura: [credito_quitacao()],
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

  it("lista cada crédito no cartão da competência com vencimento e dia do pagamento", () => {
    const azul: DashboardCartao = {
      ...cartao,
      id: "cartao-azul",
      nome: "Azul Itaú Visa Platinum",
      perfil: "pf",
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
      credito_quitacao({
        id: "credito-cartao",
        cartaoId: "cartao-azul",
        cartaoFaturaId: "cartao-azul",
        dataMovimento: "2026-07-29",
        valor: 6500.57,
      }),
      credito_quitacao({
        id: "credito-sobra",
        cartaoId: "cartao-azul",
        cartaoFaturaId: "cartao-azul",
        dataMovimento: "2026-08-05",
        valor: 11.02,
        descricao: "Pagamento PIX",
      }),
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
        data: "2026-09-06",
        pago: false,
        valor: 6500.57,
        competenciaCiclo: "2026-08",
        situacao: "aberta",
      }),
      expect.objectContaining({
        data: "2026-08-06",
        dataPagamento: "2026-08-05",
        valor: 11.02,
        pago: true,
        competenciaCiclo: "2026-07",
      }),
    ]);
    expect(faturasAgo.some((item) => item.dataPagamento === "2026-07-29")).toBe(false);

    const julho = montar_proximos_pagamentos({
      futuro: [],
      cartoes: [azul],
      movimentos: [],
      pagamentosFatura: pagamentos,
      hoje: "2026-07-29",
      periodo: { de: "2026-07-01", ate: "2026-07-31" },
    });
    const faturasJul = julho.filter((item) => item.origem === "fatura");
    expect(faturasJul).toEqual([
      expect.objectContaining({
        data: "2026-08-06",
        dataPagamento: "2026-07-29",
        valor: 6500.57,
        pago: true,
        competenciaCiclo: "2026-07",
      }),
    ]);
    expect(faturasJul.some((item) => item.dataPagamento === "2026-08-05")).toBe(false);

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
        data: "2026-10-06",
        pago: false,
        valor: 80,
        competenciaCiclo: "2026-09",
      }),
    ]);
  });

  it("depois do fechamento a fatura do mês fica a pagar com o vencimento do ciclo", () => {
    const azul: DashboardCartao = {
      ...cartao,
      id: "cartao-azul",
      nome: "Azul Itaú Visa Platinum",
      fechamento: 30,
      vencimento: 6,
      gastoMes: 8083,
    };
    const itens = montar_proximos_pagamentos({
      futuro: [],
      cartoes: [azul],
      movimentos: [],
      hoje: "2026-08-31",
      periodo: { de: "2026-08-01", ate: "2026-08-31" },
    });
    expect(itens.filter((item) => item.origem === "fatura")).toEqual([
      expect.objectContaining({
        data: "2026-09-06",
        pago: false,
        situacao: "a_pagar",
        competenciaCiclo: "2026-08",
      }),
    ]);
  });

  it("fecha 25 vence 3: em agosto a fatura aberta vence no mês seguinte", () => {
    const novo: DashboardCartao = { ...cartao, id: "c25", nome: "Cartão 25/3", fechamento: 25, vencimento: 3, gastoMes: 410 };
    const itens = montar_proximos_pagamentos({
      futuro: [],
      cartoes: [novo],
      movimentos: [],
      hoje: "2026-08-29",
      periodo: { de: "2026-08-01", ate: "2026-08-31" },
    });
    expect(itens.filter((item) => item.origem === "fatura")).toEqual([
      expect.objectContaining({
        data: "2026-09-03",
        pago: false,
        situacao: "a_pagar",
        competenciaCiclo: "2026-08",
      }),
    ]);
  });

  it("fecha 12 vence 17: em agosto a fatura aberta vence no mesmo mês", () => {
    const mp: DashboardCartao = { ...cartao, fechamento: 12, vencimento: 17, gastoMes: 320 };
    const itens = montar_proximos_pagamentos({
      futuro: [],
      cartoes: [mp],
      movimentos: [],
      hoje: "2026-08-08",
      periodo: { de: "2026-08-01", ate: "2026-08-31" },
    });
    expect(itens.filter((item) => item.origem === "fatura")).toEqual([
      expect.objectContaining({
        data: "2026-08-17",
        pago: false,
        situacao: "aberta",
      }),
    ]);
  });

  it("Pix 11,02 tagged no MP Visa + crédito no Azul vira Fatura Azul, nunca Fatura Mercado Pago", () => {
    const azul: DashboardCartao = {
      ...cartao,
      id: "cartao-azul",
      nome: "Azul Itaú Visa Platinum",
      perfil: "pf",
      fechamento: 30,
      vencimento: 6,
      gastoMes: 11.02,
    };
    const itens = montar_proximos_pagamentos({
      futuro: [],
      cartoes: [cartao, azul],
      movimentos: [],
      pagamentosFatura: [
        {
          id: "pix-conta-mp",
          status: "realizado",
          papel: "pagamento_fatura",
          cartaoFaturaId: "cartao-mp",
          competenciaFatura: "2026-08",
          dataMovimento: "2026-08-05",
          valor: 11.02,
          tipo: "despesa",
          contaId: "conta-mp",
          cartaoId: null,
          descricao: "ITAU UNIBANCO HOLDING S A",
        },
        credito_quitacao({
          id: "credito-azul",
          cartaoId: "cartao-azul",
          dataMovimento: "2026-08-05",
          valor: 11.02,
          descricao: "Pagamento PIX",
        }),
        credito_quitacao({
          id: "credito-mp",
          cartaoId: "cartao-mp",
          dataMovimento: "2026-08-13",
          valor: 3373.95,
        }),
      ],
      hoje: "2026-08-21",
      periodo: { de: "2026-08-01", ate: "2026-08-31" },
    });
    const faturas = itens.filter((item) => item.origem === "fatura");
    expect(faturas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          descricao: "Fatura Azul Itaú Visa Platinum",
          valor: 11.02,
          pago: true,
          dataPagamento: "2026-08-05",
        }),
        expect.objectContaining({
          descricao: "Fatura Mercado Pago Visa",
          valor: 3373.95,
          pago: true,
          dataPagamento: "2026-08-13",
        }),
      ]),
    );
    expect(faturas).toHaveLength(3);
    expect(faturas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          descricao: "Fatura Azul Itaú Visa Platinum",
          data: "2026-09-06",
          pago: false,
        }),
      ]),
    );
    expect(
      faturas.some((item) => item.descricao === "Fatura Mercado Pago Visa" && item.valor === 11.02),
    ).toBe(false);
  });

  it("Pessoal soma lançamento pessoal em cartão da empresa e omite fatura zerada", () => {
    const azul: DashboardCartao = {
      ...cartao,
      id: "cartao-azul",
      nome: "Azul Itaú Visa Platinum",
      perfil: "pf",
      gastoMes: 80,
    };
    const empresaComPessoal: DashboardCartao = {
      ...cartao,
      id: "cartao-pj-misto",
      nome: "Cartão Empresa",
      perfil: "pj",
      gastoMes: 150,
    };
    const empresaSoEmpresa: DashboardCartao = { ...cartao, gastoMes: 0 };
    const itens = montar_proximos_pagamentos({
      futuro: [],
      cartoes: [empresaSoEmpresa, azul, empresaComPessoal],
      movimentos: [],
      tipoGasto: "pf",
      hoje: "2026-08-21",
      periodo: { de: "2026-08-01", ate: "2026-08-31" },
    });
    const faturas = itens.filter((item) => item.origem === "fatura");
    expect(faturas).toEqual([
      expect.objectContaining({ descricao: "Fatura Azul Itaú Visa Platinum", valor: 80 }),
      expect.objectContaining({ descricao: "Fatura Cartão Empresa", valor: 150 }),
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
  it("Pessoal/Empresa soma o lançamento, mesmo em cartão do outro perfil", () => {
    const fechamento = new Map([["cartao-pf", 30]]);
    const movimentos = [
      {
        tipo: "despesa",
        valor: "80",
        dataMovimento: "2026-08-10",
        cartaoId: "cartao-pf",
        tipoGasto: "pf",
      },
      {
        tipo: "despesa",
        valor: "2300",
        dataMovimento: "2026-08-15",
        cartaoId: "cartao-pf",
        tipoGasto: "pj",
      },
    ];
    const todos = agregar_gasto_cartao_por_competencia(movimentos, fechamento, "2026-08");
    const pessoal = agregar_gasto_cartao_por_competencia(
      movimentos,
      fechamento,
      "2026-08",
      new Map(),
      [],
      "pf",
    );
    const empresa = agregar_gasto_cartao_por_competencia(
      movimentos,
      fechamento,
      "2026-08",
      new Map(),
      [],
      "pj",
    );
    expect(todos.get("cartao-pf")).toEqual({ gasto: 2380, quantidade: 2 });
    expect(pessoal.get("cartao-pf")).toEqual({ gasto: 80, quantidade: 1 });
    expect(empresa.get("cartao-pf")).toEqual({ gasto: 2300, quantidade: 1 });
  });

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

  it("aceita competência por cartão (ciclo aberto de cada um)", () => {
    const fechamento = new Map([
      ["cartao-nu", 2],
      ["cartao-mp", 12],
    ]);
    const movimentos = [
      {
        tipo: "despesa",
        valor: "9405.07",
        dataMovimento: "2026-07-30",
        cartaoId: "cartao-nu",
      },
      {
        tipo: "despesa",
        valor: "3939.68",
        dataMovimento: "2026-08-20",
        cartaoId: "cartao-nu",
      },
      {
        tipo: "despesa",
        valor: "80",
        dataMovimento: "2026-08-10",
        cartaoId: "cartao-mp",
      },
      {
        tipo: "despesa",
        valor: "3609.64",
        dataMovimento: "2026-08-25",
        cartaoId: "cartao-mp",
      },
    ];
    const mesPorCartao = new Map([
      ["cartao-nu", "2026-09"],
      ["cartao-mp", "2026-09"],
    ]);
    const aberto = agregar_gasto_cartao_por_competencia(movimentos, fechamento, mesPorCartao);
    expect(aberto.get("cartao-nu")).toEqual({ gasto: 3939.68, quantidade: 1 });
    expect(aberto.get("cartao-mp")).toEqual({ gasto: 3609.64, quantidade: 1 });
  });

  it("fecha 12: parcelas previstas no dia 1 entram no ciclo aberto, não no que já fechou", () => {
    const fechamento = new Map([["mp", 12]]);
    const vencimento = new Map([["mp", 17]]);
    const movimentos = [
      {
        tipo: "despesa",
        valor: "970.76",
        dataMovimento: "2026-08-25",
        cartaoId: "mp",
        status: "previsto",
      },
      {
        tipo: "despesa",
        valor: "621.43",
        dataMovimento: "2026-09-01",
        cartaoId: "mp",
        parcelaNumero: 2,
        status: "previsto",
      },
      {
        tipo: "despesa",
        valor: "2017.45",
        dataMovimento: "2026-09-01",
        cartaoId: "mp",
        parcelaNumero: 4,
        status: "previsto",
      },
    ];
    const setembro = agregar_gasto_cartao_por_competencia(
      movimentos,
      fechamento,
      "2026-09",
      vencimento,
    );
    expect(setembro.get("mp")?.quantidade).toBe(3);
    expect(setembro.get("mp")?.gasto).toBeCloseTo(3609.64, 2);
    const agosto = agregar_gasto_cartao_por_competencia(
      movimentos,
      fechamento,
      "2026-08",
      vencimento,
    );
    expect(agosto.get("mp")).toBeUndefined();
  });

  it("fecha 30: parcela prevista no vencimento soma no ciclo aberto; a do ciclo seguinte não", () => {
    const fechamento = new Map([["azul", 30]]);
    const vencimento = new Map([["azul", 6]]);
    const movimentos = [
      {
        tipo: "despesa",
        valor: "6500",
        dataMovimento: "2026-08-15",
        cartaoId: "azul",
        status: "previsto",
      },
      {
        tipo: "despesa",
        valor: "300",
        dataMovimento: "2026-09-08",
        cartaoId: "azul",
        parcelaNumero: 3,
        status: "previsto",
      },
      {
        tipo: "despesa",
        valor: "300",
        dataMovimento: "2026-10-06",
        cartaoId: "azul",
        parcelaNumero: 4,
        status: "previsto",
      },
    ];
    const agosto = agregar_gasto_cartao_por_competencia(movimentos, fechamento, "2026-08", vencimento);
    expect(agosto.get("azul")).toEqual({ gasto: 6800, quantidade: 2 });
  });

  it("pagamento antecipado inclui compra do dia no ciclo aberto", () => {
    const fechamento = new Map([["c1", 30]]);
    const vencimento = new Map([["c1", 6]]);
    const pagamentos = [
      {
        cartaoId: "c1",
        dataMovimento: "2026-07-29",
        competenciaFatura: "2026-07",
        papel: "pagamento_fatura" as const,
      },
    ];
    const movimentos = [
      {
        tipo: "despesa",
        valor: "800",
        dataMovimento: "2026-07-29",
        cartaoId: "c1",
      },
      {
        tipo: "despesa",
        valor: "100",
        dataMovimento: "2026-07-20",
        cartaoId: "c1",
      },
    ];
    const agosto = agregar_gasto_cartao_por_competencia(
      movimentos,
      fechamento,
      "2026-08",
      vencimento,
      pagamentos,
    );
    expect(agosto.get("c1")).toEqual({ gasto: 800, quantidade: 1 });
  });

  it("em 31/08 o ciclo aberto soma Nu+Revolut; parcela Itaú no vencimento e a quitação ficam de fora", () => {
    const fechamento = new Map([
      ["itau", 30],
      ["nu", 2],
      ["revolut", 9],
    ]);
    const vencimento = new Map([
      ["itau", 6],
      ["nu", 10],
      ["revolut", 15],
    ]);
    const mesAberto = new Map([
      ["itau", "2026-09"],
      ["nu", "2026-09"],
      ["revolut", "2026-09"],
    ]);
    const pagamentos = [
      {
        cartaoId: "itau",
        dataMovimento: "2026-08-30",
        competenciaFatura: "2026-09",
        papel: "pagamento_fatura" as const,
      },
    ];
    const movimentos = [
      { tipo: "despesa", valor: "4220.10", dataMovimento: "2026-08-20", cartaoId: "nu" },
      { tipo: "despesa", valor: "494.99", dataMovimento: "2026-08-15", cartaoId: "revolut" },
      {
        tipo: "despesa",
        valor: "1582.79",
        dataMovimento: "2026-09-08",
        cartaoId: "itau",
        parcelaNumero: 3,
        status: "previsto",
      },
      { tipo: "despesa", valor: "100", dataMovimento: "2026-08-31", cartaoId: "itau" },
    ];
    const aberto = agregar_gasto_cartao_por_competencia(
      movimentos,
      fechamento,
      mesAberto,
      vencimento,
      pagamentos,
    );
    expect(aberto.get("nu")).toEqual({ gasto: 4220.1, quantidade: 1 });
    expect(aberto.get("revolut")).toEqual({ gasto: 494.99, quantidade: 1 });
    expect(aberto.get("itau")).toBeUndefined();
    const total = [...aberto.values()].reduce((soma, item) => soma + item.gasto, 0);
    expect(total).toBeCloseTo(4715.09, 2);
  });
});

describe("mes_gasto_do_cartao", () => {
  it("no mês atual, cada cartão usa o ciclo em aberto pelo próprio fechamento", () => {
    expect(
      mes_gasto_do_cartao({
        mesSelecionado: "2026-08",
        hoje: "2026-08-28",
        fechamento: 2,
      }),
    ).toBe("2026-09");
    expect(
      mes_gasto_do_cartao({
        mesSelecionado: "2026-08",
        hoje: "2026-08-28",
        fechamento: 12,
      }),
    ).toBe("2026-09");
    expect(
      mes_gasto_do_cartao({
        mesSelecionado: "2026-08",
        hoje: "2026-08-28",
        fechamento: 30,
      }),
    ).toBe("2026-08");
    expect(
      mes_gasto_do_cartao({
        mesSelecionado: "2026-08",
        hoje: "2026-08-29",
        fechamento: 30,
      }),
    ).toBe("2026-08");
    expect(
      mes_gasto_do_cartao({
        mesSelecionado: "2026-08",
        hoje: "2026-08-30",
        fechamento: 30,
      }),
    ).toBe("2026-08");
    expect(
      mes_gasto_do_cartao({
        mesSelecionado: "2026-08",
        hoje: "2026-08-31",
        fechamento: 30,
      }),
    ).toBe("2026-09");
  });

  it("mês passado permanece no ciclo daquele mês", () => {
    expect(
      mes_gasto_do_cartao({
        mesSelecionado: "2026-07",
        hoje: "2026-08-28",
        fechamento: 2,
      }),
    ).toBe("2026-07");
  });

  it("fecha 25: em 29/08 o card já lê o ciclo seguinte", () => {
    expect(
      mes_gasto_do_cartao({
        mesSelecionado: "2026-08",
        hoje: "2026-08-29",
        fechamento: 25,
      }),
    ).toBe("2026-09");
    expect(
      mes_gasto_do_cartao({
        mesSelecionado: "2026-08",
        hoje: "2026-08-25",
        fechamento: 25,
      }),
    ).toBe("2026-08");
  });
});

describe("filtrar_movimentos_do_resultado", () => {
  it("despesa no banco fica no mês civil; cartão segue a fatura aberta", () => {
    const fechamento = new Map([["cartao-nu", 2]]);
    const mesPorCartao = new Map([["cartao-nu", "2026-09"]]);
    const visiveis = filtrar_movimentos_do_resultado(
      [
        { dataMovimento: "2026-07-30", cartaoId: "cartao-nu", valor: "9405" },
        { dataMovimento: "2026-08-20", cartaoId: "cartao-nu", valor: "3939" },
        { dataMovimento: "2026-08-15", cartaoId: null, valor: "80" },
      ],
      mesPorCartao,
      "2026-08",
      fechamento,
    );
    expect(visiveis.map((item) => item.valor).sort()).toEqual(["3939", "80"]);
  });
});
