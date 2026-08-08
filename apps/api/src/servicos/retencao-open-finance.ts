import { DIAS_RETENCAO_PAYLOAD_PADRAO } from "@lancai/open-finance";
import { obter_servico_ingestao } from "./open-finance";

export interface ResultadoRetencaoOpenFinance {
  fonteAtiva: boolean;
  dias: number;
  anonimizados: number;
}

function dias_de_retencao(): number {
  const bruto = process.env.OPEN_FINANCE_RETENCAO_DIAS?.trim();
  if (!bruto) return DIAS_RETENCAO_PAYLOAD_PADRAO;
  const n = Number(bruto);
  if (!Number.isFinite(n) || n < 1) return DIAS_RETENCAO_PAYLOAD_PADRAO;
  return Math.min(Math.floor(n), 365);
}

/**
 * Anonimiza payloads antigos de `open_finance_evento` (política LGPD do módulo).
 */
export async function aplicar_retencao_open_finance(opcoes: {
  limite?: number;
} = {}): Promise<ResultadoRetencaoOpenFinance> {
  const servico = obter_servico_ingestao();
  const dias = dias_de_retencao();

  if (!servico) {
    return { fonteAtiva: false, dias, anonimizados: 0 };
  }

  const resultado = await servico.anonimizar_payloads_antigos({
    dias,
    limite: opcoes.limite ?? 500,
  });

  return { fonteAtiva: true, ...resultado };
}
