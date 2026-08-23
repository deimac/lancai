import { describe, expect, it, vi } from "vitest";
import { SessionManager } from "../agente/session-manager";
import { SessionRepositoryMemory } from "../repositorio/session-repository-memory";

const USER = "00000000-0000-4000-8000-000000000001";

describe("SessionManager", () => {
  function montar() {
    const repo = new SessionRepositoryMemory();
    const sleeps: number[] = [];
    const manager = new SessionManager(repo, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    return { repo, manager, sleeps };
  }

  describe("obterOuCriar", () => {
    it("cria nova sessão Web se sessaoId não fornecido", async () => {
      const { manager } = montar();
      const session = await manager.obterOuCriar(USER, "web");
      expect(session.id).toBeDefined();
      expect(session.contexto.version).toBe(0);
      expect(session.contexto.schemaVersion).toBe(1);
    });

    it("reusa sessão ativa no WhatsApp", async () => {
      const { manager } = montar();
      const s1 = await manager.obterOuCriar(USER, "whatsapp");
      const s2 = await manager.obterOuCriar(USER, "whatsapp");
      expect(s1.id).toBe(s2.id);
    });

    it("cria nova sessão Web se sessaoId inexistente", async () => {
      const { manager } = montar();
      const inexistente = "00000000-0000-4000-8000-000000000099";
      const session = await manager.obterOuCriar(USER, "web", inexistente);
      expect(session.id).not.toBe(inexistente);
    });

    it("Web com sessaoId existente reusa", async () => {
      const { manager } = montar();
      const criada = await manager.obterOuCriar(USER, "web");
      const deNovo = await manager.obterOuCriar(USER, "web", criada.id);
      expect(deNovo.id).toBe(criada.id);
    });
  });

  describe("atualizarEstado (optimistic locking)", () => {
    it("incrementa version a cada update", async () => {
      const { manager, repo } = montar();
      const session = await manager.obterOuCriar(USER, "web");
      const r1 = await manager.atualizarEstado(session.id, (s) => ({
        ...s,
        explicitPeriod: { tipo: "mes_passado" },
      }));
      expect(r1.ok).toBe(true);
      const updated = await repo.get(session.id);
      expect(updated?.contexto.version).toBe(1);
      expect(updated?.contexto.explicitPeriod?.tipo).toBe("mes_passado");
    });

    it("falha em race condition e retries", async () => {
      const { manager, repo } = montar();
      const session = await manager.obterOuCriar(USER, "web");

      const p1 = manager.atualizarEstado(session.id, (s) => ({
        ...s,
        explicitPeriod: { tipo: "mes_passado" },
      }));
      const p2 = manager.atualizarEstado(session.id, (s) => ({
        ...s,
        explicitPeriod: { tipo: "mes_atual" },
      }));

      const [a, b] = await Promise.all([p1, p2]);
      expect(a.ok && b.ok).toBe(true);
      const final = await repo.get(session.id);
      expect(final?.contexto.version).toBe(2);
    });

    it("retries com backoff 50/100/150", async () => {
      const { manager, repo, sleeps } = montar();
      const session = await manager.obterOuCriar(USER, "web");
      repo.falhasCasRestantes = 3;
      const resultado = await manager.atualizarEstado(session.id, (s) => ({ ...s }));
      expect(resultado.ok).toBe(true);
      expect(sleeps).toEqual([50, 100, 150]);
      expect((await repo.get(session.id))?.contexto.version).toBe(1);
    });

    it("esgota retries e devolve erro", async () => {
      const { manager, repo } = montar();
      const session = await manager.obterOuCriar(USER, "web");
      repo.falhasCasRestantes = 10;
      const resultado = await manager.atualizarEstado(session.id, (s) => ({ ...s }));
      expect(resultado.ok).toBe(false);
      if (!resultado.ok) expect(resultado.error).toMatch(/Concurrency conflict/);
    });

    it("lock é liberado mesmo se o updater lançar", async () => {
      const { manager } = montar();
      const session = await manager.obterOuCriar(USER, "web");
      await expect(
        manager.atualizarEstado(session.id, () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");

      const depois = await manager.atualizarEstado(session.id, (s) => ({
        ...s,
        explicitPeriod: { tipo: "ano_atual" },
      }));
      expect(depois.ok).toBe(true);
    });
  });

  describe("Deduplicação WhatsApp", () => {
    it("jaProcessado retorna false para messageId novo", async () => {
      const { manager } = montar();
      await manager.obterOuCriar(USER, "whatsapp");
      expect(await manager.jaProcessado("msg-123")).toBe(false);
    });

    it("marcarProcessado + jaProcessado = true", async () => {
      const { manager } = montar();
      const session = await manager.obterOuCriar(USER, "whatsapp");
      await manager.marcarProcessado("msg-123", session.id);
      expect(await manager.jaProcessado("msg-123")).toBe(true);
    });

    it("messageId persiste após restart (mesmo repo)", async () => {
      const { repo, manager } = montar();
      const session = await manager.obterOuCriar(USER, "whatsapp");
      await manager.marcarProcessado("msg-123", session.id);
      const manager2 = new SessionManager(repo);
      expect(await manager2.jaProcessado("msg-123")).toBe(true);
    });

    it("limparMessageIdsAntigos remove só os velhos", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-23T12:00:00Z"));
      const repo = new SessionRepositoryMemory();
      const manager = new SessionManager(repo, { now: () => new Date() });
      const session = await manager.obterOuCriar(USER, "whatsapp");
      await manager.marcarProcessado("velha", session.id);
      vi.setSystemTime(new Date("2026-08-24T13:00:00Z"));
      await manager.marcarProcessado("nova", session.id);
      const removidos = await manager.limparMessageIdsAntigos();
      expect(removidos).toBe(1);
      expect(await manager.jaProcessado("velha")).toBe(false);
      expect(await manager.jaProcessado("nova")).toBe(true);
      vi.useRealTimers();
    });
  });
});
