import type { FastifyBaseLogger } from "fastify";
import { enriquecer_apos_ingestao } from "./pos-ingestao-open-finance";
import { obter_servico_ingestao } from "./open-finance";

export interface ResultadoCronOpenFinance {
  fonteAtiva: boolean;
  dryRun: boolean;
  considerados: number;
  /** Eventos cujo `processar` voltou a funcionar. */
  recuperados: number;
  falhas: number;
  movimentosCriados: number;
  detalhes: Array<{ eventoId: string; recuperado: boolean; erro?: string; criados?: number }>;
}

/**
 * Rede de segurança do Open Finance: reprocessa webhooks com `erro` preenchido
 * e aplica o mesmo pós-processo do webhook (conciliação, classificação, alerta).
 */
export async function reprocessar_eventos_open_finance(entrada: {
  log: FastifyBaseLogger;
  dryRun?: boolean;
  limite?: number;
}): Promise<ResultadoCronOpenFinance> {
  const servico = obter_servico_ingestao();
  if (!servico) {
    return {
      fonteAtiva: false,
      dryRun: Boolean(entrada.dryRun),
      considerados: 0,
      recuperados: 0,
      falhas: 0,
      movimentosCriados: 0,
      detalhes: [],
    };
  }

  const limite = entrada.limite ?? 50;

  if (entrada.dryRun) {
    const pendentes = await servico.listar_falhos({ limite });
    return {
      fonteAtiva: true,
      dryRun: true,
      considerados: pendentes.length,
      recuperados: 0,
      falhas: 0,
      movimentosCriados: 0,
      detalhes: pendentes.map((e) => ({
        eventoId: e.eventoId,
        recuperado: false,
        erro: e.erro,
      })),
    };
  }

  const resultado = await servico.reprocessar_falhos({ limite });

  for (const detalhe of resultado.detalhes) {
    if (!detalhe.ok || !detalhe.resumo) continue;
    try {
      await enriquecer_apos_ingestao({
        eventoId: detalhe.eventoId,
        resumo: detalhe.resumo,
        log: entrada.log,
      });
    } catch (erro) {
      entrada.log.warn(
        { err: erro, eventoId: detalhe.eventoId },
        "[cron] falha ao enriquecer após reprocesso OF (ignorada)",
      );
    }
  }

  return {
    fonteAtiva: true,
    dryRun: false,
    considerados: resultado.considerados,
    recuperados: resultado.ok,
    falhas: resultado.falhas,
    movimentosCriados: resultado.movimentoIdsCriados.length,
    detalhes: resultado.detalhes.map(({ eventoId, ok, erro, criados }) => ({
      eventoId,
      recuperado: ok,
      erro,
      criados,
    })),
  };
}
