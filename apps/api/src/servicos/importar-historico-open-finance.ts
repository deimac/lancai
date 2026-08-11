import type { FastifyBaseLogger } from "fastify";
import type { ConexaoDetalhada, ResumoIngestao } from "@lancai/open-finance";
import { enriquecer_apos_ingestao } from "./pos-ingestao-open-finance";
import { obter_servico_conexao, obter_servico_ingestao } from "./open-finance";
import { liberar_lock_sync, tentar_adquirir_lock_sync } from "./lock-sync-conexao";

export interface ResultadoCronImportarHistorico {
  fonteAtiva: boolean;
  dryRun: boolean;
  considerados: number;
  /** Puladas por sync recente (stale threshold). */
  puladasFrescas: number;
  /** Puladas porque outra importação já está em andamento. */
  puladasLock: number;
  /** Conexões importadas com sucesso neste lote. */
  importadas: number;
  falhas: number;
  movimentosCriados: number;
  staleAposMinutos: number;
  lookbackDias: number;
  detalhes: Array<{
    conexaoId: string;
    instituicao: string | null;
    ok: boolean;
    pulada?: "fresca" | "lock";
    criados?: number;
    erro?: string;
  }>;
}

export type DependenciasImportarHistorico = {
  listar: (limite: number) => Promise<ConexaoDetalhada[]>;
  atualizarSaldos: (conexaoId: string) => Promise<void>;
  importar: (conexaoId: string, opcoes?: { lookbackDias?: number }) => Promise<ResumoIngestao>;
  enriquecer: (entrada: {
    eventoId: string;
    resumo: ResumoIngestao;
    log: FastifyBaseLogger;
  }) => Promise<void>;
  tentarLock?: (conexaoId: string) => boolean;
  liberarLock?: (conexaoId: string) => void;
};

const PADRAO_STALE_MINUTOS = 240;
const PADRAO_LOOKBACK_DIAS = 14;
const LOOKBACK_PRIMEIRA_SYNC_DIAS = 365;

/**
 * Rede de segurança Open Finance (ADR-015): importa via GET o extrato já
 * coletado no provedor. Não chama PATCH / sync em lote.
 */
export async function importar_historico_conexoes_open_finance(entrada: {
  log: FastifyBaseLogger;
  dryRun?: boolean;
  limite?: number;
  agora?: Date;
  staleAposMinutos?: number;
  lookbackDias?: number;
  deps?: DependenciasImportarHistorico;
}): Promise<ResultadoCronImportarHistorico> {
  const limite = entrada.limite ?? 50;
  const dryRun = Boolean(entrada.dryRun);
  const agora = entrada.agora ?? new Date();
  const staleAposMinutos =
    entrada.staleAposMinutos ?? ler_int_env("OPEN_FINANCE_STALE_AFTER_MINUTES", PADRAO_STALE_MINUTOS);
  const lookbackDias =
    entrada.lookbackDias ?? ler_int_env("OPEN_FINANCE_SYNC_LOOKBACK_DAYS", PADRAO_LOOKBACK_DIAS);

  const deps = entrada.deps ?? montar_deps_padrao();
  if (!deps) {
    return {
      fonteAtiva: false,
      dryRun,
      considerados: 0,
      puladasFrescas: 0,
      puladasLock: 0,
      importadas: 0,
      falhas: 0,
      movimentosCriados: 0,
      staleAposMinutos,
      lookbackDias,
      detalhes: [],
    };
  }

  const tentarLock = deps.tentarLock ?? tentar_adquirir_lock_sync;
  const liberarLock = deps.liberarLock ?? liberar_lock_sync;

  const conexoes = await deps.listar(limite);
  const candidatas = conexoes.filter((c) => esta_stale(c.ultimoSyncEm, agora, staleAposMinutos));
  const puladasFrescas = conexoes.length - candidatas.length;

  for (const conexao of conexoes) {
    if (!esta_stale(conexao.ultimoSyncEm, agora, staleAposMinutos)) {
      entrada.log.info(
        {
          evento: "SYNC_SKIP_FRESH",
          conexaoId: conexao.id,
          instituicao: conexao.instituicao,
          ultimoSyncEm: conexao.ultimoSyncEm?.toISOString() ?? null,
          staleAposMinutos,
        },
        "[cron] SYNC_SKIP_FRESH",
      );
    }
  }

  if (dryRun) {
    return {
      fonteAtiva: true,
      dryRun: true,
      considerados: conexoes.length,
      puladasFrescas,
      puladasLock: 0,
      importadas: 0,
      falhas: 0,
      movimentosCriados: 0,
      staleAposMinutos,
      lookbackDias,
      detalhes: candidatas.map((conexao) => ({
        conexaoId: conexao.id,
        instituicao: conexao.instituicao,
        ok: false,
      })),
    };
  }

  let importadas = 0;
  let falhas = 0;
  let puladasLock = 0;
  let movimentosCriados = 0;
  const detalhes: ResultadoCronImportarHistorico["detalhes"] = [];

  for (const conexao of candidatas) {
    if (!tentarLock(conexao.id)) {
      puladasLock += 1;
      entrada.log.info(
        {
          evento: "SYNC_SKIP_LOCKED",
          conexaoId: conexao.id,
          instituicao: conexao.instituicao,
        },
        "[cron] SYNC_SKIP_LOCKED",
      );
      detalhes.push({
        conexaoId: conexao.id,
        instituicao: conexao.instituicao,
        ok: false,
        pulada: "lock",
      });
      continue;
    }

    const lookback =
      conexao.ultimoSyncEm == null ? LOOKBACK_PRIMEIRA_SYNC_DIAS : lookbackDias;

    entrada.log.info(
      {
        evento: "SYNC_START",
        conexaoId: conexao.id,
        instituicao: conexao.instituicao,
        lookbackDias: lookback,
        ultimoSyncEm: conexao.ultimoSyncEm?.toISOString() ?? null,
      },
      "[cron] SYNC_START",
    );

    try {
      await deps.atualizarSaldos(conexao.id);
      const resumo = await deps.importar(conexao.id, { lookbackDias: lookback });
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
      entrada.log.info(
        {
          evento: "SYNC_OK",
          conexaoId: conexao.id,
          instituicao: conexao.instituicao,
          criados: resumo.criados,
          duplicados: resumo.duplicados,
          atualizados: resumo.atualizados,
          semDestino: resumo.semDestino,
          paginas: resumo.paginas,
        },
        "[cron] SYNC_OK",
      );
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
        {
          evento: "SYNC_FAIL",
          err: erro,
          conexaoId: conexao.id,
          instituicao: conexao.instituicao,
          erro: mensagem,
        },
        "[cron] SYNC_FAIL",
      );
      detalhes.push({
        conexaoId: conexao.id,
        instituicao: conexao.instituicao,
        ok: false,
        erro: mensagem,
      });
    } finally {
      liberarLock(conexao.id);
    }
  }

  return {
    fonteAtiva: true,
    dryRun: false,
    considerados: conexoes.length,
    puladasFrescas,
    puladasLock,
    importadas,
    falhas,
    movimentosCriados,
    staleAposMinutos,
    lookbackDias,
    detalhes,
  };
}

export function esta_stale(
  ultimoSyncEm: Date | null,
  agora: Date,
  staleAposMinutos: number,
): boolean {
  if (ultimoSyncEm == null) return true;
  const ms = agora.getTime() - ultimoSyncEm.getTime();
  return ms >= staleAposMinutos * 60 * 1000;
}

function ler_int_env(nome: string, padrao: number): number {
  const bruto = process.env[nome]?.trim();
  if (!bruto) return padrao;
  const n = Number(bruto);
  if (!Number.isFinite(n) || n <= 0) return padrao;
  return Math.floor(n);
}

function montar_deps_padrao(): DependenciasImportarHistorico | null {
  const conexao = obter_servico_conexao();
  const ingestao = obter_servico_ingestao();
  if (!conexao || !ingestao) return null;

  return {
    listar: (limite) => conexao.listar_conexoes_importaveis(limite),
    atualizarSaldos: (id) => conexao.atualizar_saldos(id),
    importar: (id, opcoes) => ingestao.importar_historico(id, opcoes),
    enriquecer: enriquecer_apos_ingestao,
  };
}
