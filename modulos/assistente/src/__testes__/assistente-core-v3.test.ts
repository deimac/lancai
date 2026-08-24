import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ConversationUnderstanding, EntityRef } from "@lancai/tipos";
import { AssistenteCoreV3 } from "../agente/assistente-core-v3";
import { CommandExecutor } from "../agente/command-executor";
import { PolicyEngine } from "../agente/policy-engine";
import { ReferenceResolverV3 } from "../agente/reference-resolver-v3";
import type { EntityBusca, ResolverDeps } from "../agente/reference-resolver";
import { ResponseGenerator } from "../agente/response-generator";
import { SessionManagerV3 } from "../agente/session-manager-v3";
import { ApplicationService, type FinanceiroPort } from "../application/application-service";
import { MemoryIdempotencyStore } from "../application/idempotency-store";
import { documentoMistoDeContextoV3 } from "../agente/documento-misto";
import { SessionRepositoryMemory } from "../repositorio/session-repository-memory";
import {
  AGORA,
  CASOS_UNDERSTANDING,
  DATA_ATUAL,
  MOVIMENTO_UBER,
  contextoAposConsultaUber,
} from "./casos-understanding";
import { IDS } from "./helpers-assistente";

function caso(id: string) {
  const c = CASOS_UNDERSTANDING.find((x) => x.id === id);
  if (!c) throw new Error(`caso ${id} ausente`);
  return c;
}

function mapaCasos(ids: string[]): Record<string, ConversationUnderstanding> {
  const mapa: Record<string, ConversationUnderstanding> = {};
  for (const id of ids) {
    const c = caso(id);
    mapa[c.mensagem] = c.understanding;
  }
  return mapa;
}

function criarCoreV3(opcoes: { ofTarget?: EntityRef; extra?: Record<string, ConversationUnderstanding> } = {}) {
  const repo = new SessionRepositoryMemory();
  const manager = new SessionManagerV3(repo, { agoraMs: () => AGORA });
  const movimentos = new Map<string, EntityBusca>();
  if (opcoes.ofTarget) movimentos.set(opcoes.ofTarget.id, opcoes.ofTarget);

  const deps: ResolverDeps = {
    getEntityById: async (id) => movimentos.get(id) ?? null,
    getEntitiesByIds: async (ids) => ids.map((id) => movimentos.get(id)).filter((e): e is EntityBusca => Boolean(e)),
    searchEntities: async (c) => {
      const todos = [...movimentos.values()];
      if (c.merchant) {
        return todos.filter((e) => String(e.metadata?.merchant ?? e.label).toLowerCase().includes(c.merchant!));
      }
      return todos;
    },
  };

  const financeiro: FinanceiroPort = {
    criarMovimento: async (entrada) => {
      const id = randomUUID();
      const descricao = String(entrada.descricao ?? "Lançamento");
      movimentos.set(id, {
        id,
        type: "transaction",
        label: descricao,
        metadata: { valor: entrada.valor, merchant: descricao, dataMovimento: entrada.dataMovimento },
      });
      return { id, descricao, valor: entrada.valor };
    },
    corrigirFato: async (entrada) => {
      const id = String(entrada.movimentoId);
      const atual = movimentos.get(id);
      return { id, descricao: atual?.label ?? "Lançamento" };
    },
    atualizarConhecimento: async (entrada) => {
      const id = String(entrada.movimentoId);
      const atual = movimentos.get(id);
      return { id, descricao: atual?.label ?? "Lançamento" };
    },
    obterMovimento: async (id) => {
      const m = movimentos.get(id);
      if (!m) return null;
      return {
        id: m.id,
        status: "realizado",
        fonte: String(m.metadata?.fonte ?? "manual"),
        usuarioId: IDS.user,
        descricao: m.label,
      };
    },
    obterConta: async () => ({ id: IDS.conta, ativo: true }),
  };

  const app = new ApplicationService({
    financeiro,
    catalogo: {
      workspaceId: async () => IDS.ws,
      categoriaNaoClassificado: async () => IDS.cat,
    },
    idempotency: new MemoryIdempotencyStore(),
    auditoria: { logCommand: async () => undefined },
    consultas: {
      consultar: async () => {
        const ids = [...movimentos.keys()];
        return { ids, formattedText: `Encontrei ${ids.length} lançamento(s) de Uber.` };
      },
    },
  });

  const understandings = {
    ...mapaCasos([
      "create-uber-nubank",
      "consulta-total-uber",
      "continue-period-shift",
      "correcao-foi-ontem",
      "ambiguidade-tres-ubers",
      "of-delete",
      "greet",
    ]),
    ...opcoes.extra,
  };

  const core = new AssistenteCoreV3(
    manager,
    {
      extract: async ({ mensagem }) => {
        const u = understandings[mensagem];
        if (!u) throw new Error(`sem understanding para: ${mensagem}`);
        return u;
      },
    },
    new ReferenceResolverV3(deps),
    new PolicyEngine(),
    new CommandExecutor(app),
    new ResponseGenerator(),
    {
      buscarContaPorNome: async (_usuarioId, nome) => {
        if (nome.toLocaleLowerCase("pt-BR").includes("nubank")) return { id: IDS.conta, nome: "Nubank" };
        return null;
      },
      buscarCartaoPorNome: async () => null,
    },
    { agoraMs: () => AGORA, dataAtual: () => DATA_ATUAL },
  );

  return { core, repo, manager, movimentos };
}

describe("AssistenteCoreV3", () => {
  it("create resolve conta por nome, pede confirmação e executa no sim", async () => {
    const { core, repo } = criarCoreV3();
    const r1 = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Gastei 50 no Uber no Nubank",
      canal: "web",
    });
    expect(r1.diagnostico?.confirm).toBe(true);
    expect(r1.resposta.toLowerCase()).toMatch(/confirmar|uber/);

    const bruto = await repo.getDocumento(r1.sessaoId);
    expect(bruto?.documento.schemaVersion).toBe(1);
    expect((bruto?.documento.pending_action as { type?: string } | null)?.type).toBe("confirmation");

    const r2 = await core.processar({
      usuarioId: IDS.user,
      mensagem: "sim",
      sessaoId: r1.sessaoId,
      canal: "web",
    });
    expect(r2.diagnostico?.executed).toBe(true);
    expect(r2.diagnostico?.war).toBeNull();
    expect(r2.resposta.toLowerCase()).toMatch(/lançad|uber/);
  });

  it("query Uber", async () => {
    const { core } = criarCoreV3();
    const r = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Quanto gastei com Uber?",
      canal: "web",
    });
    expect(r.diagnostico?.op).toBe("query");
    expect(r.diagnostico?.executed).toBe(true);
    expect(r.resposta.toLowerCase()).toMatch(/uber|encontrei/);
  });

  it("period_shift herda Uber", async () => {
    const { core, repo } = criarCoreV3();
    const doc = await repo.createDocumento(IDS.user, documentoMistoDeContextoV3(contextoAposConsultaUber()));
    const r = await core.processar({
      usuarioId: IDS.user,
      mensagem: "E mês passado?",
      sessaoId: doc.id,
      canal: "web",
    });
    expect(r.diagnostico?.op).toBe("query");
    expect(r.diagnostico?.executed).toBe(true);
  });

  it("foi ontem pede confirmação de update", async () => {
    const { core, repo, movimentos } = criarCoreV3();
    movimentos.set(MOVIMENTO_UBER, {
      id: MOVIMENTO_UBER,
      type: "transaction",
      label: "Uber",
      metadata: { merchant: "Uber", valor: 42, dataMovimento: "2026-08-22" },
    });
    const doc = await repo.createDocumento(IDS.user, documentoMistoDeContextoV3(contextoAposConsultaUber()));
    const r = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Foi ontem",
      sessaoId: doc.id,
      canal: "web",
    });
    expect(r.diagnostico?.op).toBe("update");
    expect(r.diagnostico?.confirm || r.diagnostico?.executed).toBeTruthy();
  });

  it("ambíguo pede esclarecimento", async () => {
    const { core, repo } = criarCoreV3();
    const doc = await repo.createDocumento(IDS.user, documentoMistoDeContextoV3(contextoAposConsultaUber()));
    const r = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Corrige o Uber",
      sessaoId: doc.id,
      canal: "web",
    });
    expect(r.diagnostico?.clarification).toBe(true);
    expect(r.resposta.toLowerCase()).toMatch(/uber|detalhe|qual/);
  });

  it("OF delete é bloqueado", async () => {
    const ofTarget: EntityRef = {
      id: MOVIMENTO_UBER,
      type: "transaction",
      label: "Uber",
      metadata: { fatoImutavel: true, fonte: "open_finance", merchant: "Uber" },
    };
    const { core, repo } = criarCoreV3({ ofTarget });
    const ctx = {
      ...contextoAposConsultaUber(),
      focused_entity: ofTarget,
    };
    const doc = await repo.createDocumento(IDS.user, documentoMistoDeContextoV3(ctx));
    const r = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Apaga aquele lançamento do banco",
      sessaoId: doc.id,
      canal: "web",
    });
    expect(r.diagnostico?.blocked).toBe(true);
    expect(r.diagnostico?.reason).toBe("of_cannot_delete");
    expect(r.diagnostico?.executed).toBeFalsy();
  });

  it("greet não chama o Core financeiro", async () => {
    const { core } = criarCoreV3();
    const r = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Oi, tudo bem?",
      canal: "web",
    });
    expect(r.diagnostico?.op).toBe("greet");
    expect(r.resposta).toMatch(/olá/i);
    expect(r.diagnostico?.executed).toBeFalsy();
  });

  it("duplicata WhatsApp não reprocessa", async () => {
    const { core } = criarCoreV3();
    const r1 = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Oi, tudo bem?",
      canal: "whatsapp",
      messageId: "wa-1",
    });
    expect(r1.duplicata).toBeFalsy();
    const r2 = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Oi, tudo bem?",
      canal: "whatsapp",
      messageId: "wa-1",
    });
    expect(r2.duplicata).toBe(true);
    expect(r2.resposta).toMatch(/já processei/i);
  });

  it("shadow não grava sessão nem messageId", async () => {
    const { core, repo, manager } = criarCoreV3();
    const r = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Gastei 50 no Uber no Nubank",
      canal: "whatsapp",
      messageId: "wa-shadow",
      somenteLeitura: true,
    });
    expect(r.diagnostico?.confirm || r.diagnostico?.reason === "shadow").toBeTruthy();
    expect(await repo.getDocumento(r.sessaoId)).toBeNull();
    expect(await repo.getDocumentoByUsuarioAtiva(IDS.user)).toBeNull();
    expect(await manager.jaProcessado("wa-shadow")).toBe(false);
  });
});
