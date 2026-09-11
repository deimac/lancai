import { describe, expect, it } from "vitest";
import {
  adiar_compras_do_fechamento_ja_pago_no_cockpit,
  agregar_gasto_cartao_por_competencia,
  agregar_totais_por_natureza,
  filtrar_movimentos_por_natureza,
  mes_gasto_do_cartao,
  filtrar_movimentos_do_resultado,
  montar_fluxo_caixa,
  montar_proximos_pagamentos,
  montar_serie_faturas_dashboard,
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

  it("Pix no dia do fecha não esconde a fatura aberta de setembro", () => {
    const azul: DashboardCartao = {
      ...cartao,
      id: "cartao-azul",
      nome: "Azul Itaú Visa Platinum",
      perfil: "pf",
      fechamento: 30,
      vencimento: 6,
      gastoMes: 1491,
    };
    const itens = montar_proximos_pagamentos({
      futuro: [],
      cartoes: [azul],
      movimentos: [],
      pagamentosFatura: [
        credito_quitacao({
          id: "pix-fecha",
          cartaoId: "cartao-azul",
          dataMovimento: "2026-08-30",
          valor: 8290.62,
          competenciaFatura: "2026-09",
          descricao: "Pagamento PIX",
          status: "previsto",
        }),
      ],
      hoje: "2026-09-01",
      periodo: { de: "2026-09-01", ate: "2026-09-30" },
    });
    const faturas = itens.filter((item) => item.origem === "fatura");
    expect(faturas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          descricao: "Fatura Azul Itaú Visa Platinum",
          data: "2026-10-06",
          pago: false,
          competenciaCiclo: "2026-09",
        }),
      ]),
    );
    expect(faturas.some((item) => item.pago && item.competenciaCiclo === "2026-09")).toBe(false);
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

describe("montar_serie_faturas_dashboard", () => {
  const cartaoBase = {
    id: "cartao-mp",
    nome: "Mercado Pago Visa",
    fechamento: 10,
    vencimento: 17,
  };

  it("marca como paga quando os créditos somam o total oficial", () => {
    const meses = montar_serie_faturas_dashboard({
      cartoes: [cartaoBase],
      oficiais: [{ cartaoId: cartaoBase.id, competencia: "2026-08", total: 1000, dataFechamento: "2026-08-10" }],
      movimentos: [
        { papel: "pagamento_fatura", cartaoId: cartaoBase.id, cartaoFaturaId: cartaoBase.id, competenciaFatura: "2026-08", tipo: "receita", valor: 600, dataMovimento: "2026-08-12" },
        { papel: "pagamento_fatura", cartaoId: cartaoBase.id, cartaoFaturaId: cartaoBase.id, competenciaFatura: "2026-08", tipo: "receita", valor: 400, dataMovimento: "2026-08-15" },
      ],
      inicio: "2026-08-01",
      fim: "2026-09-30",
      hoje: "2026-09-05",
    });
    const agosto = meses.find((mes) => mes.competencia === "2026-08");
    expect(agosto).toMatchObject({ total: 1000, totalOficial: 1000, totalPago: 1000, saldo: 0, status: "paga" });
    expect(agosto?.linhas[0]).toMatchObject({ status: "paga", origem: "oficial" });
  });

  it("mantém o total oficial e marca pagamento parcial", () => {
    const meses = montar_serie_faturas_dashboard({
      cartoes: [cartaoBase],
      oficiais: [{ cartaoId: cartaoBase.id, competencia: "2026-08", total: 1000, dataFechamento: "2026-08-10" }],
      movimentos: [
        { papel: "pagamento_fatura", cartaoId: cartaoBase.id, cartaoFaturaId: cartaoBase.id, competenciaFatura: "2026-08", tipo: "receita", valor: 600, dataMovimento: "2026-08-12" },
      ],
      inicio: "2026-08-01",
      fim: "2026-08-31",
      hoje: "2026-09-05",
    });
    expect(meses[0]).toMatchObject({ total: 1000, totalOficial: 1000, totalPago: 600, saldo: 400, status: "parcial" });
  });

  it("mostra o ciclo atual sem total oficial como em aberto", () => {
    const meses = montar_serie_faturas_dashboard({
      cartoes: [cartaoBase],
      oficiais: [],
      movimentos: [
        { cartaoId: cartaoBase.id, tipo: "despesa", valor: 250, dataMovimento: "2026-09-03", status: "realizado" },
      ],
      inicio: "2026-09-01",
      fim: "2026-09-30",
      hoje: "2026-09-05",
    });
    expect(meses[0]).toMatchObject({ total: 250, totalOficial: 0, totalPago: 0, saldo: 250, status: "em_aberto" });
    expect(meses[0]?.linhas[0]).toMatchObject({ origem: "aberta", totalOficial: null });
  });

  it("aguarda confirmação para ciclo passado sem total oficial", () => {
    const meses = montar_serie_faturas_dashboard({
      cartoes: [cartaoBase],
      oficiais: [],
      movimentos: [
        { cartaoId: cartaoBase.id, tipo: "despesa", valor: 250, dataMovimento: "2026-08-03", status: "realizado" },
      ],
      inicio: "2026-08-01",
      fim: "2026-09-30",
      hoje: "2026-09-05",
    });
    const agosto = meses.find((mes) => mes.competencia === "2026-08");

    expect(agosto).toMatchObject({ total: 250, totalOficial: 0, saldo: 250, status: "aguardando_confirmacao" });
    expect(agosto?.linhas[0]).toMatchObject({ status: "aguardando_confirmacao", totalOficial: null });
  });

  /**
   * Regressão do "furo" descrito em docs/AUDITORIA_TECNICA_CARTAOES_FATURAS_V2.md:
   * um valor alto lançado dentro do ciclo local (antes do fechamento) precisa
   * somar em EXATAMENTE um mês — nunca sumir de ambos. Este teste prova que a
   * agregação do dashboard (`ciclo_do_movimento` + `dataMovimento`) está correta
   * nos dois cenários: quando o Fato fica no ciclo local (comportamento pós-fix
   * de `providerBillForecastDate` divergente) e quando ele estivesse no mês
   * seguinte (simulando o estado que o bug antigo produzia) — em nenhum dos dois
   * o valor deve ficar de fora de todos os meses.
   */
  it("valor alto no ciclo local soma no mês do ciclo, nunca desaparece", () => {
    const meses = montar_serie_faturas_dashboard({
      cartoes: [cartaoBase],
      oficiais: [],
      movimentos: [
        {
          cartaoId: cartaoBase.id,
          tipo: "despesa",
          valor: 52000,
          dataMovimento: "2026-09-08", // antes do fecha (10) → ciclo de setembro
          parcelaNumero: 1,
          status: "realizado",
        },
      ],
      inicio: "2026-09-01",
      fim: "2026-10-31",
      hoje: "2026-09-05",
    });
    const setembro = meses.find((mes) => mes.competencia === "2026-09");
    const outubro = meses.find((mes) => mes.competencia === "2026-10");
    expect(setembro).toMatchObject({ total: 52000 });
    expect(setembro?.linhas[0]).toMatchObject({ total: 52000, quantidadeLancamentos: 1 });
    expect(outubro?.linhas[0]?.quantidadeLancamentos ?? 0).toBe(0);
  });

  it("valor alto deslocado para o mês seguinte soma lá, nunca desaparece", () => {
    const meses = montar_serie_faturas_dashboard({
      cartoes: [cartaoBase],
      oficiais: [],
      movimentos: [
        {
          cartaoId: cartaoBase.id,
          tipo: "despesa",
          valor: 52000,
          dataMovimento: "2026-10-01", // deslocado (cenário do bug antigo)
          parcelaNumero: 1,
          status: "previsto",
        },
      ],
      inicio: "2026-09-01",
      fim: "2026-10-31",
      hoje: "2026-09-05",
    });
    const setembro = meses.find((mes) => mes.competencia === "2026-09");
    const outubro = meses.find((mes) => mes.competencia === "2026-10");
    expect(setembro?.linhas[0]?.quantidadeLancamentos ?? 0).toBe(0);
    expect(outubro).toMatchObject({ total: 52000 });
    expect(outubro?.linhas[0]).toMatchObject({ total: 52000, quantidadeLancamentos: 1 });
  });

  it("anexa confiancaBaixa quando há alocação previsto/possível/não resolvida para a competência", () => {
    const meses = montar_serie_faturas_dashboard({
      cartoes: [cartaoBase],
      oficiais: [],
      movimentos: [
        { cartaoId: cartaoBase.id, tipo: "despesa", valor: 250, dataMovimento: "2026-09-03", status: "realizado" },
      ],
      inicio: "2026-09-01",
      fim: "2026-09-30",
      hoje: "2026-09-05",
      alocacoesBaixaConfianca: new Map([
        [`${cartaoBase.id}:2026-09`, { quantidade: 1, valor: 250, temPrevisaoDoBanco: true }],
      ]),
    });
    expect(meses[0]?.linhas[0]?.confiancaBaixa).toEqual({
      quantidade: 1,
      valor: 250,
      temPrevisaoDoBanco: true,
    });
    // Puramente informativo: não muda nenhum valor autoritativo.
    expect(meses[0]).toMatchObject({ total: 250, status: "em_aberto" });
  });

  it("não anexa confiancaBaixa quando não há alocação de baixa confiança para a competência", () => {
    const meses = montar_serie_faturas_dashboard({
      cartoes: [cartaoBase],
      oficiais: [],
      movimentos: [
        { cartaoId: cartaoBase.id, tipo: "despesa", valor: 250, dataMovimento: "2026-09-03", status: "realizado" },
      ],
      inicio: "2026-09-01",
      fim: "2026-09-30",
      hoje: "2026-09-05",
    });
    expect(meses[0]?.linhas[0]?.confiancaBaixa).toBeUndefined();
  });

  it("soma lançamentos realizados e parcelas previstas no ciclo aberto", () => {
    const meses = montar_serie_faturas_dashboard({
      cartoes: [cartaoBase],
      oficiais: [],
      movimentos: [
        { cartaoId: cartaoBase.id, tipo: "despesa", valor: 19, dataMovimento: "2026-09-03", status: "realizado" },
        {
          cartaoId: cartaoBase.id,
          tipo: "despesa",
          valor: 31,
          dataMovimento: "2026-09-08",
          parcelaNumero: 2,
          status: "previsto",
        },
      ],
      inicio: "2026-09-01",
      fim: "2026-09-30",
      hoje: "2026-09-05",
    });

    expect(meses[0]).toMatchObject({ total: 50, totalOficial: 0, totalPago: 0, saldo: 50, status: "em_aberto" });
    expect(meses[0]?.linhas[0]).toMatchObject({
      total: 50,
      totalOficial: null,
      quantidadeLancamentos: 2,
      origem: "aberta",
      status: "em_aberto",
    });
  });

  it("exibe como prevista a fatura futura com parcela conhecida", () => {
    const meses = montar_serie_faturas_dashboard({
      cartoes: [cartaoBase],
      oficiais: [],
      movimentos: [
        {
          cartaoId: cartaoBase.id,
          tipo: "despesa",
          valor: 75,
          dataMovimento: "2026-10-03",
          parcelaNumero: 3,
          status: "previsto",
        },
      ],
      inicio: "2026-09-01",
      fim: "2026-10-31",
      hoje: "2026-09-05",
    });
    const outubro = meses.find((mes) => mes.competencia === "2026-10");

    expect(outubro).toMatchObject({ total: 75, totalOficial: 0, status: "prevista" });
    expect(outubro?.linhas[0]).toMatchObject({
      total: 75,
      totalOficial: null,
      origem: "prevista",
      status: "prevista",
    });
  });

  it("Azul (vence < fecha): mês UI setembro mostra oficial do ciclo que fechou em agosto", () => {
    const azul = { id: "cartao-azul", nome: "Azul", fechamento: 30, vencimento: 6 };
    const meses = montar_serie_faturas_dashboard({
      cartoes: [azul],
      oficiais: [
        { cartaoId: azul.id, competencia: "2025-08", total: 5486.08, dataFechamento: "2025-08-30" },
      ],
      movimentos: [
        {
          papel: "pagamento_fatura",
          cartaoId: azul.id,
          cartaoFaturaId: azul.id,
          competenciaFatura: "2025-09",
          tipo: "receita",
          valor: 5419.18,
          dataMovimento: "2025-09-03",
        },
      ],
      inicio: "2025-08-01",
      fim: "2025-09-30",
      hoje: "2025-09-10",
    });
    const setembro = meses.find((mes) => mes.competencia === "2025-09");
    expect(setembro).toMatchObject({
      total: 5486.08,
      totalOficial: 5486.08,
      totalPago: 5419.18,
      status: "parcial",
    });
    expect(setembro?.linhas[0]).toMatchObject({
      dataFechamento: "2025-08-30",
      dataVencimento: "2025-09-06",
      origem: "oficial",
    });
    const agosto = meses.find((mes) => mes.competencia === "2025-08");
    expect(agosto?.linhas.find((l) => l.cartaoId === azul.id)?.totalOficial ?? null).not.toBe(5486.08);
  });

  it("pagamento no vencimento não conta no ciclo aberto", () => {
    const azul = { id: "cartao-azul", nome: "Azul", fechamento: 30, vencimento: 6 };
    const meses = montar_serie_faturas_dashboard({
      cartoes: [azul],
      oficiais: [
        { cartaoId: azul.id, competencia: "2025-08", total: 5486.08, dataFechamento: "2025-08-30" },
      ],
      movimentos: [
        {
          papel: "pagamento_fatura",
          cartaoId: azul.id,
          cartaoFaturaId: azul.id,
          competenciaFatura: "2025-09",
          tipo: "receita",
          valor: 5419.18,
          dataMovimento: "2025-09-03",
        },
        { cartaoId: azul.id, tipo: "despesa", valor: 100, dataMovimento: "2025-09-10", status: "realizado" },
      ],
      inicio: "2025-09-01",
      fim: "2025-10-31",
      hoje: "2025-09-10",
    });
    const setembro = meses.find((mes) => mes.competencia === "2025-09");
    expect(setembro?.totalPago).toBe(5419.18);
    const outubro = meses.find((mes) => mes.competencia === "2025-10");
    // Outubro na UI = ciclo fecha setembro (aberto) — Pix de set não entra como pago desse ciclo
    expect(outubro?.totalPago ?? 0).toBe(0);
  });

  it("cartão genérico fecha 25 vence 5: UI junho aponta ciclo maio", () => {
    const cartao = { id: "c-gen", nome: "Genérico", fechamento: 25, vencimento: 5 };
    const meses = montar_serie_faturas_dashboard({
      cartoes: [cartao],
      oficiais: [
        { cartaoId: cartao.id, competencia: "2026-05", total: 900, dataFechamento: "2026-05-25" },
      ],
      movimentos: [],
      inicio: "2026-05-01",
      fim: "2026-06-30",
      hoje: "2026-06-10",
    });
    const junho = meses.find((mes) => mes.competencia === "2026-06");
    expect(junho).toMatchObject({ total: 900, totalOficial: 900 });
    expect(junho?.linhas[0]?.dataVencimento).toBe("2026-06-05");
  });

  it("cartão manual fechado e 100% pago mostra 'paga', nunca 'aguardando_confirmacao'", () => {
    const cartaoManual = { ...cartaoBase, id: "cartao-manual", sincronizada: false };
    const meses = montar_serie_faturas_dashboard({
      cartoes: [cartaoManual],
      oficiais: [], // cartão manual nunca tem fatura_oficial (não vem do Pluggy)
      movimentos: [
        { cartaoId: cartaoManual.id, tipo: "despesa", valor: 300, dataMovimento: "2026-08-03", status: "realizado" },
        { papel: "pagamento_fatura", cartaoId: cartaoManual.id, cartaoFaturaId: cartaoManual.id, competenciaFatura: "2026-08", tipo: "receita", valor: 300, dataMovimento: "2026-08-12" },
      ],
      inicio: "2026-08-01",
      fim: "2026-09-30",
      hoje: "2026-09-05",
    });
    const agosto = meses.find((mes) => mes.competencia === "2026-08");
    expect(agosto).toMatchObject({ total: 300, totalOficial: 0, totalPago: 300, saldo: 0, status: "paga" });
  });

  it("cartão manual fechado e sem pagamento mostra 'em_aberto', nunca 'aguardando_confirmacao'", () => {
    const cartaoManual = { ...cartaoBase, id: "cartao-manual", sincronizada: false };
    const meses = montar_serie_faturas_dashboard({
      cartoes: [cartaoManual],
      oficiais: [],
      movimentos: [
        { cartaoId: cartaoManual.id, tipo: "despesa", valor: 300, dataMovimento: "2026-08-03", status: "realizado" },
      ],
      inicio: "2026-08-01",
      fim: "2026-09-30",
      hoje: "2026-09-05",
    });
    const agosto = meses.find((mes) => mes.competencia === "2026-08");
    expect(agosto).toMatchObject({ total: 300, totalOficial: 0, totalPago: 0, saldo: 300, status: "em_aberto" });
  });

  it("cartão manual fechado e parcialmente pago mostra 'parcial'", () => {
    const cartaoManual = { ...cartaoBase, id: "cartao-manual", sincronizada: false };
    const meses = montar_serie_faturas_dashboard({
      cartoes: [cartaoManual],
      oficiais: [],
      movimentos: [
        { cartaoId: cartaoManual.id, tipo: "despesa", valor: 300, dataMovimento: "2026-08-03", status: "realizado" },
        { papel: "pagamento_fatura", cartaoId: cartaoManual.id, cartaoFaturaId: cartaoManual.id, competenciaFatura: "2026-08", tipo: "receita", valor: 150, dataMovimento: "2026-08-12" },
      ],
      inicio: "2026-08-01",
      fim: "2026-09-30",
      hoje: "2026-09-05",
    });
    const agosto = meses.find((mes) => mes.competencia === "2026-08");
    expect(agosto).toMatchObject({ total: 300, totalPago: 150, saldo: 150, status: "parcial" });
  });

  it("cartão sincronizado (Pluggy) fechado e 100% pago localmente mostra 'paga' mesmo sem fatura_oficial ainda", () => {
    const cartaoOF = { ...cartaoBase, id: "cartao-of", sincronizada: true };
    const meses = montar_serie_faturas_dashboard({
      cartoes: [cartaoOF],
      oficiais: [],
      movimentos: [
        { cartaoId: cartaoOF.id, tipo: "despesa", valor: 300, dataMovimento: "2026-08-03", status: "realizado" },
        { papel: "pagamento_fatura", cartaoId: cartaoOF.id, cartaoFaturaId: cartaoOF.id, competenciaFatura: "2026-08", tipo: "receita", valor: 300, dataMovimento: "2026-08-12" },
      ],
      inicio: "2026-08-01",
      fim: "2026-09-30",
      hoje: "2026-09-05",
    });
    const agosto = meses.find((mes) => mes.competencia === "2026-08");
    expect(agosto).toMatchObject({ total: 300, totalPago: 300, saldo: 0, status: "paga" });
  });

  it("cartão sincronizado (Pluggy) fechado, não pago e sem fatura_oficial ainda mostra 'aguardando_confirmacao'", () => {
    const cartaoOF = { ...cartaoBase, id: "cartao-of", sincronizada: true };
    const meses = montar_serie_faturas_dashboard({
      cartoes: [cartaoOF],
      oficiais: [],
      movimentos: [
        { cartaoId: cartaoOF.id, tipo: "despesa", valor: 250, dataMovimento: "2026-08-03", status: "realizado" },
      ],
      inicio: "2026-08-01",
      fim: "2026-09-30",
      hoje: "2026-09-05",
    });
    const agosto = meses.find((mes) => mes.competencia === "2026-08");
    expect(agosto).toMatchObject({ status: "aguardando_confirmacao" });
  });

  describe("compra no dia do fechamento de fatura já paga", () => {
    it("desloca pro ciclo seguinte quando o ciclo já está paga (oficial)", () => {
      const meses = montar_serie_faturas_dashboard({
        cartoes: [cartaoBase],
        oficiais: [{ cartaoId: cartaoBase.id, competencia: "2026-08", total: 1000, dataFechamento: "2026-08-10" }],
        movimentos: [
          { papel: "pagamento_fatura", cartaoId: cartaoBase.id, cartaoFaturaId: cartaoBase.id, competenciaFatura: "2026-08", tipo: "receita", valor: 1000, dataMovimento: "2026-08-12" },
          // Chegou depois — datada bem no dia do fechamento (10) do ciclo já pago.
          { cartaoId: cartaoBase.id, tipo: "despesa", valor: 50, dataMovimento: "2026-08-10", status: "realizado" },
        ],
        inicio: "2026-08-01",
        fim: "2026-09-30",
        hoje: "2026-09-05",
      });
      const agosto = meses.find((mes) => mes.competencia === "2026-08");
      const setembro = meses.find((mes) => mes.competencia === "2026-09");

      // Agosto continua com o total oficial e SEM o ajuste dos R$50 (foram pro ciclo seguinte).
      expect(agosto).toMatchObject({ total: 1000, totalPago: 1000, status: "paga" });
      expect(agosto?.linhas[0]?.ajuste).toBe(1000);
      // Setembro (ciclo aberto) já enxerga a despesa.
      expect(setembro?.linhas[0]).toMatchObject({ quantidadeLancamentos: 1, total: 50 });
    });

    it("não desloca quando o ciclo ainda não está paga", () => {
      const meses = montar_serie_faturas_dashboard({
        cartoes: [cartaoBase],
        oficiais: [{ cartaoId: cartaoBase.id, competencia: "2026-08", total: 1000, dataFechamento: "2026-08-10" }],
        movimentos: [
          // Pagamento parcial — ciclo de agosto NÃO está "paga".
          { papel: "pagamento_fatura", cartaoId: cartaoBase.id, cartaoFaturaId: cartaoBase.id, competenciaFatura: "2026-08", tipo: "receita", valor: 200, dataMovimento: "2026-08-12" },
          { cartaoId: cartaoBase.id, tipo: "despesa", valor: 50, dataMovimento: "2026-08-10", status: "realizado" },
        ],
        inicio: "2026-08-01",
        fim: "2026-09-30",
        hoje: "2026-09-05",
      });
      const agosto = meses.find((mes) => mes.competencia === "2026-08");
      const setembro = meses.find((mes) => mes.competencia === "2026-09");

      expect(agosto?.linhas[0]?.ajuste).toBe(950); // 1000 - 50: a despesa continua contando em agosto
      expect(setembro?.linhas[0]?.quantidadeLancamentos ?? 0).toBe(0);
    });

    it("não desloca parcela — só compra avulsa", () => {
      const meses = montar_serie_faturas_dashboard({
        cartoes: [cartaoBase],
        oficiais: [{ cartaoId: cartaoBase.id, competencia: "2026-08", total: 1000, dataFechamento: "2026-08-10" }],
        movimentos: [
          { papel: "pagamento_fatura", cartaoId: cartaoBase.id, cartaoFaturaId: cartaoBase.id, competenciaFatura: "2026-08", tipo: "receita", valor: 1000, dataMovimento: "2026-08-12" },
          {
            cartaoId: cartaoBase.id,
            tipo: "despesa",
            valor: 50,
            dataMovimento: "2026-08-10",
            status: "realizado",
            parcelaNumero: 2,
          },
        ],
        inicio: "2026-08-01",
        fim: "2026-09-30",
        hoje: "2026-09-05",
      });
      const agosto = meses.find((mes) => mes.competencia === "2026-08");
      expect(agosto?.linhas[0]?.ajuste).toBe(950); // parcela continua em agosto, não desloca
    });
  });

  describe("crédito de regra (subtrair_valor) abate o saldo quando há totalOficial", () => {
    it("estorno marcado por regra reduz o saldo aberto mesmo com fatura oficial fixa", () => {
      const meses = montar_serie_faturas_dashboard({
        cartoes: [cartaoBase],
        oficiais: [{ cartaoId: cartaoBase.id, competencia: "2026-07", total: 1000, dataFechamento: "2026-07-10" }],
        movimentos: [
          // Pagamento parcial via pagamento_fatura de verdade.
          { papel: "pagamento_fatura", cartaoId: cartaoBase.id, cartaoFaturaId: cartaoBase.id, competenciaFatura: "2026-07", tipo: "receita", valor: 853.52, dataMovimento: "2026-07-12" },
          // Estorno de compra marcado pela regra "subtrair_valor" — sem isso,
          // não sobra R$ 146,48 sem explicação no saldo. Data ≤ fechamento (10)
          // pra ficar no ciclo de julho.
          { cartaoId: cartaoBase.id, tipo: "estorno", valor: 146.48, dataMovimento: "2026-07-08", status: "realizado", efeitoValor: "subtrai" },
        ],
        inicio: "2026-07-01",
        fim: "2026-08-31",
        hoje: "2026-08-05",
      });
      const julho = meses.find((mes) => mes.competencia === "2026-07");
      expect(julho).toMatchObject({ totalOficial: 1000, totalPago: 1000, saldo: 0, status: "paga" });
    });

    it("não conta em dobro quando NÃO há totalOficial (já líquido no total local)", () => {
      const meses = montar_serie_faturas_dashboard({
        cartoes: [cartaoBase],
        oficiais: [],
        movimentos: [
          { cartaoId: cartaoBase.id, tipo: "despesa", valor: 300, dataMovimento: "2026-07-03", status: "realizado" },
          { cartaoId: cartaoBase.id, tipo: "estorno", valor: 100, dataMovimento: "2026-07-08", status: "realizado", efeitoValor: "subtrai" },
        ],
        inicio: "2026-07-01",
        fim: "2026-08-31",
        hoje: "2026-08-05",
      });
      const julho = meses.find((mes) => mes.competencia === "2026-07");
      // total já vem líquido (300 - 100 = 200) via valor_na_fatura; totalPago
      // continua 0 — se contasse em dobro, o saldo ficaria negativo/zerado à toa.
      expect(julho).toMatchObject({ total: 200, totalPago: 0, saldo: 200 });
    });
  });
});

describe("adiar_compras_do_fechamento_ja_pago_no_cockpit", () => {
  const cartaoNu = { id: "cartao-nu", fechamento: 2, vencimento: 9 };

  it("desloca compra do dia do fechamento de um ciclo já pago, some do mês fechado e some no seguinte", () => {
    const movimentos = [
      // Fatura de setembro (2026-09) já confirmada e 100% paga.
      {
        papel: "pagamento_fatura",
        cartaoId: cartaoNu.id,
        cartaoFaturaId: cartaoNu.id,
        competenciaFatura: "2026-09",
        tipo: "receita",
        valor: 10000,
        dataMovimento: "2026-09-09",
        status: "realizado",
      },
      // Compra de R$ 52.000 chegou depois, datada bem no dia do fechamento (2).
      {
        cartaoId: cartaoNu.id,
        tipo: "despesa",
        valor: 52000,
        dataMovimento: "2026-09-02",
        status: "realizado",
      },
    ];
    const oficialPorChave = new Map([[`${cartaoNu.id}:2026-09`, 10000]]);

    const ajustados = adiar_compras_do_fechamento_ja_pago_no_cockpit(
      movimentos,
      [cartaoNu],
      oficialPorChave,
    );

    const compraAjustada = ajustados.find((m) => m.valor === 52000)!;
    expect(compraAjustada.dataMovimento).toBe("2026-09-03");

    // Setembro (mês fechado) não vê mais a compra.
    const gastoSetembro = agregar_gasto_cartao_por_competencia(
      ajustados,
      new Map([[cartaoNu.id, cartaoNu.fechamento]]),
      "2026-09",
      new Map([[cartaoNu.id, cartaoNu.vencimento]]),
    ).get(cartaoNu.id) ?? { gasto: 0, quantidade: 0 };
    expect(gastoSetembro.quantidade).toBe(0);

    // Outubro (ciclo seguinte) passa a ver a compra — uma vez só.
    const gastoOutubro = agregar_gasto_cartao_por_competencia(
      ajustados,
      new Map([[cartaoNu.id, cartaoNu.fechamento]]),
      "2026-10",
      new Map([[cartaoNu.id, cartaoNu.vencimento]]),
    ).get(cartaoNu.id) ?? { gasto: 0, quantidade: 0 };
    expect(gastoOutubro).toMatchObject({ gasto: 52000, quantidade: 1 });
  });

  it("não desloca quando o ciclo ainda não está pago", () => {
    const movimentos = [
      {
        papel: "pagamento_fatura",
        cartaoId: cartaoNu.id,
        cartaoFaturaId: cartaoNu.id,
        competenciaFatura: "2026-09",
        tipo: "receita",
        valor: 3000,
        dataMovimento: "2026-09-09",
        status: "realizado",
      },
      {
        cartaoId: cartaoNu.id,
        tipo: "despesa",
        valor: 52000,
        dataMovimento: "2026-09-02",
        status: "realizado",
      },
    ];
    const oficialPorChave = new Map([[`${cartaoNu.id}:2026-09`, 10000]]);

    const ajustados = adiar_compras_do_fechamento_ja_pago_no_cockpit(
      movimentos,
      [cartaoNu],
      oficialPorChave,
    );

    const compra = ajustados.find((m) => m.valor === 52000)!;
    expect(compra.dataMovimento).toBe("2026-09-02");
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

  it("fecha 30: parcela prevista em setembro soma na fatura de setembro, não na de agosto", () => {
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
    expect(agosto.get("azul")).toEqual({ gasto: 6500, quantidade: 1 });
    const setembro = agregar_gasto_cartao_por_competencia(
      movimentos,
      fechamento,
      "2026-09",
      vencimento,
    );
    expect(setembro.get("azul")).toEqual({ gasto: 300, quantidade: 1 });
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

  it("em 31/08 o ciclo aberto do Itaú já é setembro: parcela e compra pós-fecha somam", () => {
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
    expect(aberto.get("itau")).toEqual({ gasto: 1682.79, quantidade: 2 });
    const total = [...aberto.values()].reduce((soma, item) => soma + item.gasto, 0);
    expect(total).toBeCloseTo(6397.88, 2);
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
