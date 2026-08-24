import { describe, expect, it } from "vitest";
import { estadoInicialConversacaoV3 } from "@lancai/tipos";
import { documentoMistoDeContextoV3 } from "../agente/documento-misto";
import { SessionManagerV3 } from "../agente/session-manager-v3";
import { SessionManager } from "../agente/session-manager";
import { SessionRepositoryMemory } from "../repositorio/session-repository-memory";

const USER = "00000000-0000-4000-8000-000000000001";
const AGORA = 1_777_000_000_000;

describe("SessionManagerV3 (documento misto)", () => {
  function montar() {
    const repo = new SessionRepositoryMemory();
    const sleeps: number[] = [];
    const manager = new SessionManagerV3(repo, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      agoraMs: () => AGORA,
    });
    return { repo, manager, sleeps };
  }

  it("cria sessão com schemaVersion 1 no JSON persistido e schema 2 em memória", async () => {
    const { manager, repo } = montar();
    const session = await manager.obterOuCriar(USER, "web");
    expect(session.contexto.schemaVersion).toBe(2);
    expect(session.contexto.version).toBe(0);

    const bruto = await repo.getDocumento(session.id);
    expect(bruto?.documento.schemaVersion).toBe(1);
    expect(bruto?.documento.active_topic).toBeNull();
    expect(bruto?.documento.topic_history).toEqual([]);

    const v1 = await repo.get(session.id);
    expect(v1?.contexto.schemaVersion).toBe(1);
    expect(v1?.contexto.version).toBe(0);
  });

  it("roundtrip preserva chaves v3 e o get v2 continua válido", async () => {
    const { manager, repo } = montar();
    const session = await manager.obterOuCriar(USER, "web");
    const r = await manager.atualizarEstado(session.id, (ctx) => ({
      ...ctx,
      active_topic: { domain: "spending", period: { tipo: "mes_atual" } },
      active_goal: "analyze",
    }));
    expect(r.ok).toBe(true);

    const bruto = await repo.getDocumento(session.id);
    expect(bruto?.documento.schemaVersion).toBe(1);
    expect(bruto?.documento.version).toBe(1);
    expect(bruto?.documento.active_topic).toEqual({ domain: "spending", period: { tipo: "mes_atual" } });
    expect(bruto?.documento.active_goal).toBe("analyze");

    const v1 = await repo.get(session.id);
    expect(v1?.contexto.schemaVersion).toBe(1);
    expect(v1?.contexto.version).toBe(1);
    expect((v1?.contexto as { active_topic?: unknown }).active_topic).toBeUndefined();

    const deNovo = await manager.obterOuCriar(USER, "web", session.id);
    expect(deNovo.contexto.schemaVersion).toBe(2);
    expect(deNovo.contexto.active_topic?.domain).toBe("spending");
    expect(deNovo.contexto.version).toBe(1);

    const misto = documentoMistoDeContextoV3(estadoInicialConversacaoV3(AGORA));
    expect(misto.schemaVersion).toBe(1);
  });

  it("CAS incrementa a mesma version nos dois lados", async () => {
    const { manager, repo } = montar();
    const session = await manager.obterOuCriar(USER, "web");
    await manager.atualizarEstado(session.id, (c) => c);
    const doc = await repo.getDocumento(session.id);
    const v1 = await repo.get(session.id);
    expect(doc?.documento.version).toBe(1);
    expect(v1?.contexto.version).toBe(1);
  });

  it("reusa sessão ativa no WhatsApp", async () => {
    const { manager } = montar();
    const s1 = await manager.obterOuCriar(USER, "whatsapp");
    const s2 = await manager.obterOuCriar(USER, "whatsapp");
    expect(s1.id).toBe(s2.id);
  });

  it("shadow não persiste sessão nova", async () => {
    const { manager, repo } = montar();
    const session = await manager.obterOuCriar(USER, "web", undefined, { persistir: false });
    expect(await repo.getDocumento(session.id)).toBeNull();
    expect(await repo.getDocumentoByUsuarioAtiva(USER)).toBeNull();
  });

  it("SessionManager v1 continua lendo sessão criada pelo V3", async () => {
    const { manager, repo } = montar();
    const v3 = await manager.obterOuCriar(USER, "web");
    const v1 = new SessionManager(repo);
    const lido = await v1.obterOuCriar(USER, "web", v3.id);
    expect(lido.id).toBe(v3.id);
    expect(lido.contexto.schemaVersion).toBe(1);
  });
});
