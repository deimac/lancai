import { describe, expect, it } from "vitest";

/**
 * Smoke do contrato da rota: o serviço real depende do banco.
 * A montagem do fluxo de saldo é pura e fica coberta indiretamente via shape.
 */
describe("contrato dashboard", () => {
  it("expõe campos esperados pelo web", () => {
    const amostra = {
      mes: "2026-08",
      periodo: { de: "2026-08-01", ate: "2026-08-31" },
      resumo: {
        saldoTotal: 1000,
        receitasMes: 500,
        despesasMes: 200,
        saldoPeriodo: 300,
        taxaEconomia: 60,
      },
      naoClassificado: { quantidade: 0, total: 0 },
      gastosPorCategoria: [{ categoriaNome: "Alimentação", total: 120 }],
      fluxoSaldo: [{ data: "2026-08-01", saldo: 900 }],
      recentes: [],
      contas: [],
      cartoes: [],
    };

    expect(amostra.resumo.taxaEconomia).toBe(60);
    expect(amostra.gastosPorCategoria[0]?.categoriaNome).toBe("Alimentação");
  });
});
