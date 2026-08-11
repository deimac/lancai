import type { FastifyBaseLogger } from "fastify";
import type { ConexaoDetalhada, ResumoIngestao } from "@lancai/open-finance";
import { enriquecer_apos_ingestao } from "./pos-ingestao-open-finance";
import { obter_servico_conexao, obter_servico_ingestao } from "./open-finance";

export interface ResultadoCronImportarHistorico {
  fonteAtiva: boolean;
  dryRun: boolean;
  considerados: number;
  /** Conexões importadas com sucesso neste lote. */
  importadas: number;
  falhas: number;
  movimentosCriados: number;
  detalhes: Array<{
    conexaoId: string;
    instituicao: string | null;
    ok: boolean;
    criados?: number;
    erro?: string;
  }>;
}

export type DependenciasImportarHistorico = {
  listar: (limite: number) => Promise<ConexaoDetalhada[]>;
  atualizarSaldos: (conexaoId: string) => Promise<void>;
  importar: (conexaoId: string) => Promise<ResumoIngestao>;
  enriquecer: (entrada: {
    eventoId: string;
    resumo: ResumoIngestao;
    log: FastifyBaseLogger;
  }) => Promise<void>;
};

/**
 * Rede de segurança Open Finance (ADR-015): importa via GET o extrato já
 * coletado no provedor. Não chama PATCH / sync em lote.
 */
export async function importar_historico_conexoes_open_finance(entrada: {
  log: FastifyBaseLogger;
  dryRun?: boolean;
  limite?: number;
  deps?: DependenciasImportarHistorico;
}): Promise<ResultadoCronImportarHistorico> {
  const limite = entrada.limite ?? 50;
  const dryRun = Boolean(entrada.dryRun);

  const deps = entrada.deps ?? montar_deps_padrao();
  if (!deps) {
    return {
      fonteAtiva: false,
      dryRun,
      considerados: 0,
      importadas: 0,
      falhas: 0,
      movimentosCriados: 0,
      detalhes: [],
    };
  }

  const conexoes = await deps.listar(limite);

  if (dryRun) {
    return {
      fonteAtiva: true,
      dryRun: true,
      considerados: conexoes.length,
      importadas: 0,
      falhas: 0,
      movimentosCriados: 0,
      detalhes: conexoes.map((conexao) => ({
        conexaoId: conexao.id,
        instituicao: conexao.instituicao,
        ok: false,
      })),
    };
  }

  let importadas = 0;
  let falhas = 0;
  let movimentosCriados = 0;
  const detalhes: ResultadoCronImportarHistorico["detalhes"] = [];

  for (const conexao of conexoes) {
    try {
      await deps.atualizarSaldos(conexao.id);
      const resumo = await deps.importar(conexao.id);
      try {
        await deps.enriquecer({
          eventoId: `cron-importar-historico:${conexao.id}:${Date.now()}`,
          resumo,
          log: entrada.log,
        });
      } catch (erro) {
        entrada.log.warn(
          { err: erro, conexaoId: conexao.id },
          "[cron] falha ao enriquecer após importar histórico OF (ignorada)",
        );
      }
      importadas += 1;
      movimentosCriados += resumo.criados;
      detalhes.push({
        conexaoId: conexao.id,
        instituicao: conexao.instituicao,
        ok: true,
        criados: resumo.criados,
      });
    } catch (erro) {
      falhas += 1;
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      entrada.log.warn(
        { err: erro, conexaoId: conexao.id },
        "[cron] falha ao importar histórico OF",
      );
      detalhes.push({
        conexaoId: conexao.id,
        instituicao: conexao.instituicao,
        ok: false,
        erro: mensagem,
      });
    }
  }

  return {
    fonteAtiva: true,
    dryRun: false,
    considerados: conexoes.length,
    importadas,
    falhas,
    movimentosCriados,
    detalhes,
  };
}

function montar_deps_padrao(): DependenciasImportarHistorico | null {
  const conexao = obter_servico_conexao();
  const ingestao = obter_servico_ingestao();
  if (!conexao || !ingestao) return null;

  return {
    listar: (limite) => conexao.listar_conexoes_importaveis(limite),
    atualizarSaldos: (id) => conexao.atualizar_saldos(id),
    importar: (id) => ingestao.importar_historico(id),
    enriquecer: enriquecer_apos_ingestao,
  };
}
