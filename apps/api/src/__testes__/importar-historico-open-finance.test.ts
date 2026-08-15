import { describe, expect, it, vi } from "vitest";
import {
  ErroConexaoExternaInexistente,
  type ConexaoDetalhada,
  type ResumoIngestao,
} from "@lancai/open-finance";
import {
  esta_stale,
  importar_historico_conexoes_open_finance,
} from "../servicos/importar-historico-open-finance";

function conexao(parcial: Partial<ConexaoDetalhada> & { id: string }): ConexaoDetalhada {
  return {
    workspaceId: "ws",
    criadoPor: "user",
    idExterno: `ext-${parcial.id}`,
    status: "ativa",
    perfilPadrao: "pf",
    instituicao: "Banco Teste",
    motivoAtencao: null,
    ultimoSyncEm: null,
    consentimentoExpiraEm: null,
    ultimoResumoIngestao: null,
    ...parcial,
  };
}

function resumo(criados: number): ResumoIngestao {
  return {
    criados,
    duplicados: 0,
    atualizados: 0,
    removidos: 0,
    semDestino: 0,
    puladosSemanticos: 0,
    paginas: 1,
    movimentoIdsCriados: Array.from({ length: criados }, (_, i) => `mov-${i}`),
  };
}

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Parameters<typeof importar_historico_conexoes_open_finance>[0]["log"];

describe("esta_stale", () => {
  const agora = new Date("2026-08-11T12:00:00.000Z");

  it("trata null como stale", () => {
    expect(esta_stale(null, agora, 240)).toBe(true);
  });

  it("respeita o limiar em minutos", () => {
    expect(esta_stale(new Date("2026-08-11T10:00:00.000Z"), agora, 240)).toBe(false);
    expect(esta_stale(new Date("2026-08-11T07:00:00.000Z"), agora, 240)).toBe(true);
  });
});

describe("importar_historico_conexoes_open_finance", () => {
  it("dryRun lista só candidatas stale sem importar", async () => {
    const agora = new Date("2026-08-11T12:00:00.000Z");
    const listar = vi.fn(async () => [
      conexao({ id: "fresca", ultimoSyncEm: new Date("2026-08-11T11:00:00.000Z") }),
      conexao({ id: "stale", ultimoSyncEm: new Date("2026-08-11T06:00:00.000Z") }),
    ]);
    const importar = vi.fn();

    const resultado = await importar_historico_conexoes_open_finance({
      log,
      dryRun: true,
      agora,
      staleAposMinutos: 240,
      deps: {
        listar,
        atualizarSaldos: vi.fn(),
        importar,
        enriquecer: vi.fn(),
      },
    });

    expect(resultado.fonteAtiva).toBe(true);
    expect(resultado.dryRun).toBe(true);
    expect(resultado.considerados).toBe(2);
    expect(resultado.puladasFrescas).toBe(1);
    expect(resultado.detalhes).toEqual([
      expect.objectContaining({ conexaoId: "stale" }),
    ]);
    expect(importar).not.toHaveBeenCalled();
  });

  it("pula conexão fresca e importa só stale", async () => {
    const agora = new Date("2026-08-11T12:00:00.000Z");
    const listar = vi.fn(async () => [
      conexao({ id: "fresca", ultimoSyncEm: new Date("2026-08-11T11:30:00.000Z") }),
      conexao({ id: "stale", ultimoSyncEm: null }),
    ]);
    const importar = vi.fn(async () => resumo(2));
    const locks = new Set<string>();

    const resultado = await importar_historico_conexoes_open_finance({
      log,
      agora,
      staleAposMinutos: 240,
      lookbackDias: 14,
      deps: {
        listar,
        atualizarSaldos: vi.fn(),
        importar,
        enriquecer: vi.fn(),
        tentarLock: (id) => {
          if (locks.has(id)) return false;
          locks.add(id);
          return true;
        },
        liberarLock: (id) => {
          locks.delete(id);
        },
      },
    });

    expect(resultado.puladasFrescas).toBe(1);
    expect(resultado.importadas).toBe(1);
    expect(importar).toHaveBeenCalledTimes(1);
    expect(importar).toHaveBeenCalledWith("stale", { lookbackDias: 365 });
  });

  it("usa lookback curto quando já houve sync", async () => {
    const agora = new Date("2026-08-11T12:00:00.000Z");
    const importar = vi.fn(async () => resumo(0));

    await importar_historico_conexoes_open_finance({
      log,
      agora,
      staleAposMinutos: 60,
      lookbackDias: 14,
      deps: {
        listar: async () => [
          conexao({ id: "c1", ultimoSyncEm: new Date("2026-08-11T10:00:00.000Z") }),
        ],
        atualizarSaldos: vi.fn(),
        importar,
        enriquecer: vi.fn(),
        tentarLock: () => true,
        liberarLock: () => undefined,
      },
    });

    expect(importar).toHaveBeenCalledWith("c1", { lookbackDias: 14 });
  });

  it("pula quando o lock está ocupado", async () => {
    const resultado = await importar_historico_conexoes_open_finance({
      log,
      staleAposMinutos: 1,
      deps: {
        listar: async () => [conexao({ id: "ocupada" })],
        atualizarSaldos: vi.fn(),
        importar: vi.fn(),
        enriquecer: vi.fn(),
        tentarLock: () => false,
        liberarLock: vi.fn(),
      },
    });

    expect(resultado.puladasLock).toBe(1);
    expect(resultado.importadas).toBe(0);
    expect(resultado.detalhes[0]).toEqual(
      expect.objectContaining({ conexaoId: "ocupada", pulada: "lock" }),
    );
  });

  it("continua o lote quando uma conexão falha", async () => {
    const listar = vi.fn(async () => [
      conexao({ id: "falha", instituicao: "A" }),
      conexao({ id: "ok", instituicao: "B" }),
    ]);
    const atualizarSaldos = vi.fn(async (id: string) => {
      if (id === "falha") throw new Error("provedor indisponível: timeout");
    });
    const importar = vi.fn(async () => resumo(3));
    const enriquecer = vi.fn(async () => undefined);

    const resultado = await importar_historico_conexoes_open_finance({
      log,
      staleAposMinutos: 1,
      deps: {
        listar,
        atualizarSaldos,
        importar,
        enriquecer,
        tentarLock: () => true,
        liberarLock: () => undefined,
      },
    });

    expect(resultado.considerados).toBe(2);
    expect(resultado.importadas).toBe(1);
    expect(resultado.falhas).toBe(1);
    expect(resultado.movimentosCriados).toBe(3);
    expect(importar).toHaveBeenCalledTimes(1);
    expect(importar).toHaveBeenCalledWith("ok", { lookbackDias: 365 });
    expect(enriquecer).toHaveBeenCalledTimes(1);
    expect(resultado.detalhes).toEqual([
      expect.objectContaining({ conexaoId: "falha", ok: false, erro: expect.stringContaining("timeout") }),
      expect.objectContaining({ conexaoId: "ok", ok: true, criados: 3 }),
    ]);
  });

  it("trata item inexistente à parte de SYNC_FAIL", async () => {
    const atualizarSaldos = vi.fn(async () => {
      throw new ErroConexaoExternaInexistente("GET /items/x devolveu HTTP 404");
    });
    const importar = vi.fn();

    const resultado = await importar_historico_conexoes_open_finance({
      log,
      staleAposMinutos: 1,
      deps: {
        listar: async () => [conexao({ id: "sumiu", instituicao: "Banco" })],
        atualizarSaldos,
        importar,
        enriquecer: vi.fn(),
        tentarLock: () => true,
        liberarLock: () => undefined,
      },
    });

    expect(resultado.itensInexistentes).toBe(1);
    expect(resultado.falhas).toBe(0);
    expect(resultado.importadas).toBe(0);
    expect(importar).not.toHaveBeenCalled();
    expect(resultado.detalhes).toEqual([
      expect.objectContaining({
        conexaoId: "sumiu",
        ok: false,
        erro: "item_inexistente",
      }),
    ]);
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ evento: "SYNC_ITEM_GONE", conexaoId: "sumiu" }),
      "[cron] SYNC_ITEM_GONE",
    );
  });

  it("não chama PATCH: só saldos + importar", async () => {
    const atualizarSaldos = vi.fn(async () => undefined);
    const importar = vi.fn(async () => resumo(0));

    await importar_historico_conexoes_open_finance({
      log,
      staleAposMinutos: 1,
      deps: {
        listar: async () => [conexao({ id: "c1" })],
        atualizarSaldos,
        importar,
        enriquecer: vi.fn(),
        tentarLock: () => true,
        liberarLock: () => undefined,
      },
    });

    expect(atualizarSaldos).toHaveBeenCalledWith("c1");
    expect(importar).toHaveBeenCalledWith("c1", { lookbackDias: 365 });
  });
});
