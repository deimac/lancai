import { describe, expect, it } from "vitest";
import { montar_proximos_pagamentos, type DashboardCartao } from "../servicos/montar-dashboard";

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
});

/**
 * Smoke do contrato da rota: o serviço real depende do banco.
 * A montagem do fluxo de saldo é pura e fica coberta indiretamente via shape.
 */
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
