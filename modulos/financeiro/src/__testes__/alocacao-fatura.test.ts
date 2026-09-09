import { describe, expect, it } from "vitest";
import { decidir_alocacao_fatura } from "../alocacao-fatura";

describe("decidir_alocacao_fatura", () => {
    it("L0: providerBillId com fatura resolvida vira confirmado/provider_bill_id", () => {
        const decisao = decidir_alocacao_fatura({
            providerBillId: "bill-123",
            faturaOficialParaBillId: { id: "fat-1", competencia: "2026-09" },
            providerBillForecastDate: "2026-10",
            dataMovimento: "2026-08-15",
            fechamentoCartao: 20,
        });

        expect(decisao).toEqual({
            status: "confirmado",
            metodo: "provider_bill_id",
            competencia: "2026-09",
            faturaOficialId: "fat-1",
            confidenceScore: 100,
        });
    });

    it("billId presente sem fatura resolvida não vira confirmado (cai para o próximo nível)", () => {
        const decisao = decidir_alocacao_fatura({
            providerBillId: "bill-123",
            faturaOficialParaBillId: null,
            providerBillForecastDate: "2026-10",
            dataMovimento: "2026-08-15",
            fechamentoCartao: 20,
        });

        expect(decisao.status).toBe("previsto");
        expect(decisao.metodo).toBe("provider_forecast");
    });

    it("L1: providerBillForecastDate vira previsto/provider_forecast, nunca confirmado", () => {
        const decisao = decidir_alocacao_fatura({
            providerBillForecastDate: "2026-10",
            dataMovimento: "2026-08-15",
            fechamentoCartao: 20,
        });

        expect(decisao).toEqual({
            status: "previsto",
            metodo: "provider_forecast",
            competencia: "2026-10",
            confidenceScore: 80,
        });
    });

    it("L2: sem evidência do provedor, usa a regra do ciclo local", () => {
        const decisao = decidir_alocacao_fatura({
            dataMovimento: "2026-08-25",
            fechamentoCartao: 20,
        });

        expect(decisao).toEqual({
            status: "possivel",
            metodo: "regra_ciclo",
            competencia: "2026-09",
            confidenceScore: 50,
        });
    });

    it("L6: sem nenhuma evidência (nem ciclo do cartão) vira nao_resolvido", () => {
        const decisao = decidir_alocacao_fatura({ dataMovimento: "2026-08-25" });

        expect(decisao).toEqual({ status: "nao_resolvido", metodo: "nao_resolvido" });
    });

    it("compra no dia do fechamento fica no ciclo que fecha (regra existente)", () => {
        const decisao = decidir_alocacao_fatura({ dataMovimento: "2026-08-20", fechamentoCartao: 20 });
        expect(decisao.competencia).toBe("2026-08");
    });
});
