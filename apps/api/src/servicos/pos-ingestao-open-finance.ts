import type { FastifyBaseLogger } from "fastify";
import { RepositorioConhecimentoDrizzle, ServicoConhecimento } from "@lancai/conhecimento";
import {
  ClassificadorCategoria,
  OrquestradorIA,
  classificacao_ia_habilitada,
} from "@lancai/ia";
import type { ResumoIngestao } from "@lancai/open-finance";
import { avisar_orcamentos_apos_movimentos } from "./alerta-orcamento-open-finance";
import { conciliar_manuais_com_fatos_criados } from "./conciliar-manual-com-fonte";

const orquestradorClassificacao = new OrquestradorIA();
const classificadorCategoria = new ClassificadorCategoria(orquestradorClassificacao);

/**
 * Tudo que acontece depois do Core gravar Fato: conciliação manual↔banco,
 * classificação (regra → IA) e alerta de orçamento. Mora no composition root
 * porque Open Finance não conhece Conhecimento nem WhatsApp.
 */
export async function enriquecer_apos_ingestao(entrada: {
  eventoId: string;
  resumo: ResumoIngestao;
  log: FastifyBaseLogger;
}): Promise<void> {
  const { eventoId, resumo, log } = entrada;
  if (resumo.movimentoIdsCriados.length === 0) return;

  const conhecimento = new ServicoConhecimento(new RepositorioConhecimentoDrizzle());
  const iaLigada = classificacao_ia_habilitada();
  let porRegra = 0;
  let porIa = 0;
  const fatosCasados = new Set<string>();

  try {
    const conciliacao = await conciliar_manuais_com_fatos_criados({
      movimentoIdsCriados: resumo.movimentoIdsCriados,
      conhecimento,
    });
    for (const par of conciliacao.pares) fatosCasados.add(par.fatoId);
    if (conciliacao.casados > 0) {
      log.info(
        { eventoId, casados: conciliacao.casados },
        "[open-finance] conciliação manual/recorrência↔banco",
      );
    }
  } catch (erroConciliacao) {
    log.warn(
      { err: erroConciliacao, eventoId },
      "[open-finance] falha na conciliação (ignorada)",
    );
  }

  for (const movimentoId of resumo.movimentoIdsCriados) {
    if (fatosCasados.has(movimentoId)) continue;
    try {
      const herdouSerie = await conhecimento.herdar_classificacao_da_serie(movimentoId);
      if (herdouSerie) continue;
      const herdouIgual = await conhecimento.herdar_classificacao_de_iguais(movimentoId);
      if (herdouIgual) continue;
      if (!iaLigada) {
        const soRegra = await conhecimento.aplicar_regras(movimentoId);
        if (soRegra.aplicada) porRegra += 1;
        else if (await conhecimento.aplicar_heuristica_estabelecimento(movimentoId)) porIa += 1;
        continue;
      }

      const resultado = await conhecimento.classificar(movimentoId, classificadorCategoria);
      if (resultado.etapa === "regra" && resultado.resultado.aplicada) porRegra += 1;
      if (resultado.etapa === "ia" && resultado.resultado.aplicada) porIa += 1;
    } catch (erroClassificacao) {
      log.warn(
        { err: erroClassificacao, movimentoId },
        "[open-finance] falha ao classificar após ingestão",
      );
    }
  }

  if (porRegra > 0 || porIa > 0) {
    log.info({ eventoId, porRegra, porIa }, "[open-finance] classificação após ingestão");
  }

  try {
    const alerta = await avisar_orcamentos_apos_movimentos({
      movimentoIds: resumo.movimentoIdsCriados,
    });
    if (alerta.enviados > 0 || alerta.falhas > 0) {
      log.info({ eventoId, ...alerta }, "[open-finance] alerta de orçamento pós-ingestão");
    }
  } catch (erroAlerta) {
    log.warn(
      { err: erroAlerta, eventoId },
      "[open-finance] falha ao alertar orçamento (ignorada)",
    );
  }
}
