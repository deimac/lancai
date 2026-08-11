import { describe, expect, it, vi } from "vitest";
import type { ConexaoDetalhada, ResumoIngestao } from "@lancai/open-finance";
import { importar_historico_conexoes_open_finance } from "../servicos/importar-historico-open-finance";

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
    paginas: 1,
    movimentoIdsCriados: Array.from({ length: criados }, (_, i) => `mov-${i}`),
  };
}

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Parameters<typeof importar_historico_conexoes_open_finance>[0]["log"];

describe("importar_historico_conexoes_open_finance", () => {
  it("dryRun lista conexões sem importar", async () => {
    const listar = vi.fn(async () => [conexao({ id: "a" }), conexao({ id: "b" })]);
    const importar = vi.fn();

    const resultado = await importar_historico_conexoes_open_finance({
      log,
      dryRun: true,
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
    expect(importar).not.toHaveBeenCalled();
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
      deps: { listar, atualizarSaldos, importar, enriquecer },
    });

    expect(resultado.considerados).toBe(2);
    expect(resultado.importadas).toBe(1);
    expect(resultado.falhas).toBe(1);
    expect(resultado.movimentosCriados).toBe(3);
    expect(importar).toHaveBeenCalledTimes(1);
    expect(importar).toHaveBeenCalledWith("ok");
    expect(enriquecer).toHaveBeenCalledTimes(1);
    expect(resultado.detalhes).toEqual([
      expect.objectContaining({ conexaoId: "falha", ok: false, erro: expect.stringContaining("timeout") }),
      expect.objectContaining({ conexaoId: "ok", ok: true, criados: 3 }),
    ]);
  });

  it("não chama PATCH: só saldos + importar", async () => {
    const atualizarSaldos = vi.fn(async () => undefined);
    const importar = vi.fn(async () => resumo(0));

    await importar_historico_conexoes_open_finance({
      log,
      deps: {
        listar: async () => [conexao({ id: "c1" })],
        atualizarSaldos,
        importar,
        enriquecer: vi.fn(),
      },
    });

    expect(atualizarSaldos).toHaveBeenCalledWith("c1");
    expect(importar).toHaveBeenCalledWith("c1");
  });
});
