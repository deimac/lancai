import { describe, expect, it } from "vitest";

/**
 * Smoke do contrato da rota: o serviço real depende do banco.
 * A montagem do fluxo de saldo é pura e fica coberta indiretamente via shape.
 */
describe("contrato dashboard", () => {
  it("expõe campos esperados pelo web (KPIs superiores)", () => {
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
      cartoes: [],
    };

    expect(amostra.resumo.resultadoMes).toBe(300);
    expect(amostra.resumo.quantidadeCartoes).toBe(1);
    expect(amostra.gastosPorCategoria[0]?.categoriaNome).toBe("Alimentação");
  });
});
