import { competencia_ciclo_da_data } from "@lancai/tipos";

/**
 * Hierarquia de evidências (ver docs/AUDITORIA_TECNICA_CARTAOES_FATURAS_V2.md, §G.4):
 * `providerBillId` (L0, confirmação) > `providerBillForecastDate` (L1, previsão)
 * > ciclo local do cartão (L2, regra determinística) > sem evidência (`nao_resolvido`).
 *
 * `billForecastDate` NUNCA é tratado como confirmação — mesmo quando bate com o
 * ciclo local, o método fica `provider_forecast` e o status `previsto`.
 */
export type StatusAlocacaoFatura = "confirmado" | "previsto" | "possivel" | "nao_resolvido";
export type MetodoAlocacaoFatura =
    | "provider_bill_id"
    | "provider_forecast"
    | "regra_ciclo"
    | "historico"
    | "correspondencia"
    | "manual"
    | "nao_resolvido";

export interface CandidatoAlocacaoFatura {
    /** Evidência L0 já traduzida do provedor (`movimento.providerBillId`). */
    providerBillId?: string | null;
    /**
     * Fatura fechada correspondente ao `providerBillId`, quando já ingerida.
     * Sem ela, `billId` é evidência sem alvo resolvível — não vira `confirmado`.
     */
    faturaOficialParaBillId?: { id: string; competencia: string } | null;
    /** Evidência L1 (`movimento.providerBillForecastDate`), competência `YYYY-MM`. */
    providerBillForecastDate?: string | null;
    /** Data do movimento (`YYYY-MM-DD`), para a regra de ciclo (L2). */
    dataMovimento: string;
    /** Fechamento do cartão, dia do mês. Sem cartão/fechamento não há regra de ciclo. */
    fechamentoCartao?: number | null;
}

export interface DecisaoAlocacaoFatura {
    status: StatusAlocacaoFatura;
    metodo: MetodoAlocacaoFatura;
    /** Competência alvo (`YYYY-MM`). Ausente somente quando `status = 'nao_resolvido'`. */
    competencia?: string;
    /** Preenchido só quando o método é `provider_bill_id` e a fatura já foi resolvida. */
    faturaOficialId?: string;
    /** 0-100, informativo. Nunca é autoridade — só `status`/`metodo` são. */
    confidenceScore?: number;
}

/**
 * Decide a alocação de UM movimento com base na evidência disponível. Função
 * pura e determinística — nenhuma consulta ao banco, nenhum LLM.
 */
export function decidir_alocacao_fatura(candidato: CandidatoAlocacaoFatura): DecisaoAlocacaoFatura {
    if (candidato.providerBillId && candidato.faturaOficialParaBillId) {
        return {
            status: "confirmado",
            metodo: "provider_bill_id",
            competencia: candidato.faturaOficialParaBillId.competencia,
            faturaOficialId: candidato.faturaOficialParaBillId.id,
            confidenceScore: 100,
        };
    }

    if (candidato.providerBillForecastDate) {
        return {
            status: "previsto",
            metodo: "provider_forecast",
            competencia: candidato.providerBillForecastDate,
            confidenceScore: 80,
        };
    }

    if (candidato.fechamentoCartao != null) {
        return {
            status: "possivel",
            metodo: "regra_ciclo",
            competencia: competencia_ciclo_da_data(candidato.dataMovimento, candidato.fechamentoCartao),
            confidenceScore: 50,
        };
    }

    return { status: "nao_resolvido", metodo: "nao_resolvido" };
}
