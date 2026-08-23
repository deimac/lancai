import { randomUUID } from "node:crypto";
import { estadoInicialConversacao } from "@lancai/tipos";
import type { EntityRef } from "@lancai/tipos";
import { AssistenteCore } from "../agente/assistente-core";
import { SemanticParserV2 } from "../agente/semantic-parser-v2";
import { ReferenceResolver, type EntityBusca, type ResolverDeps } from "../agente/reference-resolver";
import { PolicyEngine } from "../agente/policy-engine";
import { CommandExecutor } from "../agente/command-executor";
import { StateUpdater } from "../agente/state-updater";
import { ResponseGenerator } from "../agente/response-generator";
import { SessionManager } from "../agente/session-manager";
import { SessionRepositoryMemory } from "../repositorio/session-repository-memory";
import { ApplicationService, type FinanceiroPort } from "../application/application-service";
import { MemoryIdempotencyStore } from "../application/idempotency-store";

export const IDS = {
  user: "00000000-0000-4000-8000-000000000001",
  conta: "00000000-0000-4000-8000-000000000202",
  cat: "00000000-0000-4000-8000-000000000201",
  ws: "00000000-0000-4000-8000-000000000010",
};

export function criarAssistenteTeste(opcoes: { ofTarget?: EntityRef } = {}) {
  const repo = new SessionRepositoryMemory();
  const manager = new SessionManager(repo);
  const movimentos = new Map<string, EntityBusca>();
  if (opcoes.ofTarget) movimentos.set(opcoes.ofTarget.id, opcoes.ofTarget);

  const deps: ResolverDeps = {
    getEntityById: async (id) => movimentos.get(id) ?? null,
    getEntitiesByIds: async (ids) => ids.map((id) => movimentos.get(id)).filter((e): e is EntityBusca => Boolean(e)),
    searchEntities: async (c) => {
      const todos = [...movimentos.values()];
      if (c.merchant) {
        return todos.filter((e) =>
          String(e.metadata?.merchant ?? e.label).toLowerCase().includes(c.merchant!),
        );
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
        return { ids, formattedText: `Encontrei ${ids.length} lançamento(s).` };
      },
    },
  });

  const parser = new SemanticParserV2({
    contextoDe: () => ({
      dataAtual: "2026-08-23",
      contas: [{ nome: "Nubank", perfil: "pf" }],
      cartoes: [],
      categorias: [],
      pessoas: [],
      habitos: [],
      historicoRecente: [],
    }),
  });

  const core = new AssistenteCore(
    manager,
    parser,
    new ReferenceResolver(deps),
    new PolicyEngine(),
    new CommandExecutor(app),
    new StateUpdater(),
    new ResponseGenerator(),
  );

  return { core, repo, movimentos };
}

export function estadoComDefaults() {
  return {
    ...estadoInicialConversacao(),
    userPreferencesRef: { defaultAccountId: IDS.conta },
  };
}
