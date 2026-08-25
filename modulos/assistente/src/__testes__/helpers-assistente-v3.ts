import { randomUUID } from "node:crypto";
import type { ConversationUnderstanding, DialogueAct, EntityRef } from "@lancai/tipos";
import { AssistenteCoreV3 } from "../agente/assistente-core-v3";
import { CommandExecutor } from "../agente/command-executor";
import { documentoMistoDeContextoV3 } from "../agente/documento-misto";
import { PolicyEngine } from "../agente/policy-engine";
import type { EntityBusca, ResolverDeps } from "../agente/reference-resolver";
import { ReferenceResolverV3 } from "../agente/reference-resolver-v3";
import { ResponseGenerator } from "../agente/response-generator";
import { SessionManagerV3 } from "../agente/session-manager-v3";
import { understandingToDialogueAct } from "../agente/understanding-to-dialogue-act";
import { ApplicationService, type FinanceiroPort } from "../application/application-service";
import { MemoryIdempotencyStore } from "../application/idempotency-store";
import { SessionRepositoryMemory } from "../repositorio/session-repository-memory";
import {
  AGORA,
  CASOS_UNDERSTANDING,
  DATA_ATUAL,
  MOVIMENTO_IFOOD,
  MOVIMENTO_UBER,
  MOVIMENTO_UBER_B,
  MOVIMENTO_UBER_C,
} from "./casos-understanding";
import { IDS } from "./helpers-assistente";

export const IDS_V3 = {
  ...IDS,
  itau: "00000000-0000-4000-8000-000000000203",
  cartao: "00000000-0000-4000-8000-000000000204",
};

export function casoUnderstanding(id: string) {
  const c = CASOS_UNDERSTANDING.find((x) => x.id === id);
  if (!c) throw new Error(`caso ${id} ausente`);
  return c;
}

function mapaUnderstandings(extra?: Record<string, ConversationUnderstanding>): Record<string, ConversationUnderstanding> {
  const mapa: Record<string, ConversationUnderstanding> = {};
  for (const c of CASOS_UNDERSTANDING) {
    mapa[c.mensagem] = c.understanding;
  }
  return { ...mapa, ...extra };
}

function semearPadrao(movimentos: Map<string, EntityBusca>) {
  const ubers: EntityBusca[] = [
    {
      id: MOVIMENTO_UBER,
      type: "transaction",
      label: "Uber 42",
      metadata: { merchant: "Uber", valor: 42, dataMovimento: "2026-08-21" },
    },
    {
      id: MOVIMENTO_UBER_B,
      type: "transaction",
      label: "Uber 35",
      metadata: { merchant: "Uber", valor: 35, dataMovimento: "2026-08-22" },
    },
    {
      id: MOVIMENTO_UBER_C,
      type: "transaction",
      label: "Uber 62",
      metadata: { merchant: "Uber", valor: 62, dataMovimento: "2026-08-20" },
    },
  ];
  for (const u of ubers) movimentos.set(u.id, u);
  movimentos.set(MOVIMENTO_IFOOD, {
    id: MOVIMENTO_IFOOD,
    type: "transaction",
    label: "iFood 32",
    metadata: { merchant: "iFood", valor: 32, dataMovimento: "2026-08-20" },
  });
}

export function criarAssistenteCoreV3Teste(opcoes: {
  ofTarget?: EntityRef;
  extra?: Record<string, ConversationUnderstanding>;
  acts?: Record<string, DialogueAct>;
} = {}) {
  const repo = new SessionRepositoryMemory();
  const manager = new SessionManagerV3(repo, { agoraMs: () => AGORA });
  const movimentos = new Map<string, EntityBusca>();
  semearPadrao(movimentos);
  if (opcoes.ofTarget) movimentos.set(opcoes.ofTarget.id, opcoes.ofTarget);

  const deps: ResolverDeps = {
    getEntityById: async (id) => movimentos.get(id) ?? null,
    getEntitiesByIds: async (ids) => ids.map((id) => movimentos.get(id)).filter((e): e is EntityBusca => Boolean(e)),
    searchEntities: async (c) => {
      return [...movimentos.values()].filter((e) => {
        if (c.merchant) {
          const rotulo = String(e.metadata?.merchant ?? e.label).toLowerCase();
          if (!rotulo.includes(c.merchant.toLowerCase())) return false;
        }
        const data = typeof e.metadata?.dataMovimento === "string" ? e.metadata.dataMovimento : "";
        if (c.dateFrom && data && data < c.dateFrom) return false;
        if (c.dateTo && data && data > c.dateTo) return false;
        if (c.valor != null && Number(e.metadata?.valor) !== c.valor) return false;
        return true;
      });
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
        usuarioId: IDS_V3.user,
        descricao: m.label,
      };
    },
    obterConta: async (id) => ({ id, ativo: true }),
  };

  const app = new ApplicationService({
    financeiro,
    catalogo: {
      workspaceId: async () => IDS_V3.ws,
      categoriaNaoClassificado: async () => IDS_V3.cat,
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

  const understandings = mapaUnderstandings(opcoes.extra);

  const core = new AssistenteCoreV3(
    manager,
    {
      extract: async ({ mensagem, context, dataAtual }) => {
        const actDireto = opcoes.acts?.[mensagem];
        if (actDireto) return { act: actDireto };
        const u = understandings[mensagem];
        if (!u) throw new Error(`sem understanding para: ${mensagem}`);
        return {
          act: understandingToDialogueAct(u, context, { dataAtual, mensagem }),
          understanding: u,
        };
      },
    },
    new ReferenceResolverV3(deps),
    new PolicyEngine(),
    new CommandExecutor(app),
    new ResponseGenerator(),
    {
      buscarContaPorNome: async (_usuarioId, nome) => {
        const n = nome.toLocaleLowerCase("pt-BR");
        if (n.includes("nubank")) return { id: IDS_V3.conta, nome: "Nubank" };
        if (n.includes("ita")) return { id: IDS_V3.itau, nome: "Itaú" };
        if (n.includes("mercado")) return { id: IDS_V3.conta, nome: "Mercado Pago" };
        return null;
      },
      buscarCartaoPorNome: async (_usuarioId, nome) => {
        const n = nome.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{M}/gu, "");
        if (n.includes("cartao") || n.includes("revolut") || n.includes("nubank")) {
          return { id: IDS_V3.cartao, nome: "Nubank" };
        }
        return null;
      },
    },
    { agoraMs: () => AGORA, dataAtual: () => DATA_ATUAL },
  );

  return { core, repo, manager, movimentos };
}

export async function processarCasoV3(id: string, canal: "web" | "whatsapp" = "web") {
  const c = casoUnderstanding(id);
  const ofTarget =
    c.context?.focused_entity?.metadata?.fatoImutavel === true ? c.context.focused_entity : undefined;
  const { core, repo, manager, movimentos } = criarAssistenteCoreV3Teste({ ofTarget });
  let sessaoId: string | undefined;
  if (c.context && (c.context.last_query || c.context.focused_entity || c.context.pending_action)) {
    const doc = await repo.createDocumento(IDS_V3.user, documentoMistoDeContextoV3(c.context));
    sessaoId = doc.id;
  }
  const saida = await core.processar({
    usuarioId: IDS_V3.user,
    mensagem: c.mensagem,
    sessaoId,
    canal,
  });
  return { saida, core, repo, manager, movimentos, caso: c };
}
