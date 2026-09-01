import { createHash, randomUUID } from "node:crypto";
import { prefixar_nota_dia_semana } from "@lancai/ia";
import { ZodError } from "zod";
import {
  ConfirmationRequestSchema,
  EntityRefSchema,
  ExecutionPlanSchema,
  hojeISO,
  queryStateFromSpec,
  estadoConsultaNovo,
  type Ambiguity,
  type ConversationContext,
  type ConversationUnderstanding,
  type DialogueAct,
  type EntityRef,
  type ExecutionPlan,
  type PolicyDecision,
  type QueryNames,
  type QueryState,
  type ResolutionResult,
  type ResultContext,
  type ResultRefHint,
  type SimpleCommand,
  type SlotOp,
} from "@lancai/tipos";
import type { AssistenteInput, AssistenteOutput } from "./assistente-core";
import { applySlotOps } from "./apply-slot-ops";
import { coerirDialogueActComContexto } from "./coerir-dialogue-act";
import { CommandExecutor } from "./command-executor";
import { specCompiladoDe } from "./compile-query";
import { DialogueActInvalidoError, type EntradaDialogueActExtractor } from "./dialogue-act-extractor";
import { planCommand, planCommandFromAct, planCancelarLancamentos } from "./command-planner";
import {
  updateAfterExecution,
  updateAfterPlan,
  updateAfterReferenceResolved,
  updateAfterUnderstanding,
} from "./context-updater";
import { PolicyEngine } from "./policy-engine";
import { ReferenceResolverV3 } from "./reference-resolver-v3";
import { ResponseGenerator } from "./response-generator";
import { SessionManagerV3 } from "./session-manager-v3";
import { detectWrongAction } from "./war-detector";
import type { TurnoUnderstanding } from "../prompts/understanding";

export type ExtracaoTurnoV3 = {
  act: DialogueAct;
  understanding?: ConversationUnderstanding;
};

export type ExtractorTurnoV3 = {
  extract(input: EntradaDialogueActExtractor): Promise<ExtracaoTurnoV3>;
};

export type OrigemCatalogoAssistente = { id: string; nome: string; sincronizada: boolean };

export type CatalogoNomesAssistente = {
  buscarContaPorNome(usuarioId: string, nome: string): Promise<OrigemCatalogoAssistente | null>;
  buscarCartaoPorNome(usuarioId: string, nome: string): Promise<OrigemCatalogoAssistente | null>;
};

export type AssistenteCoreV3Opcoes = {
  carregarHistorico?: (sessaoId: string) => Promise<TurnoUnderstanding[]>;
  agoraMs?: () => number;
  dataAtual?: () => string;
};

function textoGreet(primeiroNome?: string): string {
  const ola = primeiroNome ? `Olá, ${primeiroNome}.` : "Olá.";
  return `${ola} Sou o Xai. Posso lançar gastos, consultar extrato ou corrigir um lançamento.`;
}

function hashPlan(plan: ExecutionPlan): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex").slice(0, 32);
}

function hashQuery(query: QueryState): string {
  return createHash("sha256").update(JSON.stringify(query)).digest("hex").slice(0, 32);
}

function promoverQueryState(ctx: ConversationContext): ConversationContext {
  if (ctx.query) return ctx;
  if (!ctx.last_query) return ctx;
  return {
    ...ctx,
    query: queryStateFromSpec(ctx.last_query.query_spec, ctx.last_query.information_need),
  };
}

function ehActConsulta(
  act: DialogueAct,
): act is Extract<DialogueAct, { act: "new_query" | "patch_query" | "change_grain" | "refresh" }> {
  return act.act === "new_query" || act.act === "patch_query" || act.act === "change_grain" || act.act === "refresh";
}

function textoDiagnostico(suspicion: string | undefined, ctx: ConversationContext): string {
  const grain = ctx.query?.grain ?? "summary";
  if (suspicion === "category") return "Posso detalhar por categoria se você pedir a lista.";
  if (suspicion === "duplicate") return "Se houver duplicata, aponte o lançamento na lista.";
  if (ctx.result?.stale) return "Os totais podem estar desatualizados. Peça para atualizar a consulta.";
  return grain === "list"
    ? "Esses são os lançamentos da consulta atual. Quer filtrar ou corrigir algum?"
    : "O total vem da consulta atual. Peça a lista se quiser ver cada lançamento.";
}

function idsDaFaixaOrdinal(
  de: number,
  ate: number,
  ctx: ConversationContext,
): Array<{ id: string; label: string; ordinal: number }> {
  const ini = Math.min(de, ate);
  const fim = Math.max(de, ate);
  const rows = ctx.result?.rows ?? [];
  if (rows.length > 0) {
    return rows
      .filter((r) => r.ordinal >= ini && r.ordinal <= fim)
      .map((r) => ({ id: r.entityId, label: r.label, ordinal: r.ordinal }));
  }
  const fallback = ctx.last_query?.result_ids ?? [];
  return fallback.slice(ini - 1, fim).map((id, i) => ({
    id,
    label: String(ini + i),
    ordinal: ini + i,
  }));
}

function resolverHintResultado(hint: ResultRefHint, ctx: ConversationContext): ResolutionResult {
  if (hint.by === "ordinal_range") {
    const ini = Math.min(hint.de, hint.ate);
    const fim = Math.max(hint.de, hint.ate);
    if (ini === fim) return resolverHintResultado({ by: "ordinal", n: ini }, ctx);
    const faixa = idsDaFaixaOrdinal(hint.de, hint.ate, ctx);
    if (faixa.length === 0) return { status: "not_found", reason: "Não achei esses itens na lista." };
    if (faixa.length === 1) {
      return resolverHintResultado({ by: "ordinal", n: faixa[0]!.ordinal }, ctx);
    }
    return {
      status: "ambiguous",
      candidates: faixa.map((item) => ({
        entity: { id: item.id, type: "transaction" as const, label: item.label },
        confidence: 0.9,
        method: "positional" as const,
      })),
    };
  }

  const rows = ctx.result?.rows ?? [];
  const ids = rows.map((r) => r.entityId);
  const fallbackIds = ctx.last_query?.result_ids ?? [];
  const lista = ids.length > 0 ? ids : fallbackIds;

  if (hint.by === "ordinal") {
    const row = rows.find((r) => r.ordinal === hint.n);
    const id = row?.entityId ?? lista[hint.n - 1];
    if (!id) return { status: "not_found", reason: "Não achei esse item na lista." };
    return {
      status: "resolved",
      entity: {
        entity: {
          id,
          type: row?.entityType ?? "transaction",
          label: row?.label ?? String(hint.n),
        },
        confidence: 1,
        method: "positional",
      },
    };
  }

  if (hint.by === "amount") {
    const matches = rows.filter((r) => r.amount === hint.value);
    if (matches.length === 1) {
      const row = matches[0]!;
      return {
        status: "resolved",
        entity: {
          entity: { id: row.entityId, type: row.entityType, label: row.label },
          confidence: 1,
          method: "value",
        },
      };
    }
    if (matches.length > 1) {
      return {
        status: "ambiguous",
        candidates: matches.map((row) => ({
          entity: { id: row.entityId, type: row.entityType, label: row.label },
          confidence: 0.7,
          method: "value" as const,
        })),
      };
    }
    return { status: "not_found", reason: "Não achei lançamento com esse valor." };
  }

  if (hint.by === "label") {
    const alvo = hint.text.toLocaleLowerCase("pt-BR");
    const matches = rows.filter((r) => r.label.toLocaleLowerCase("pt-BR").includes(alvo));
    if (matches.length === 1) {
      const row = matches[0]!;
      return {
        status: "resolved",
        entity: {
          entity: { id: row.entityId, type: row.entityType, label: row.label },
          confidence: 0.9,
          method: "merchant",
        },
      };
    }
    if (matches.length > 1) {
      return {
        status: "ambiguous",
        candidates: matches.map((row) => ({
          entity: { id: row.entityId, type: row.entityType, label: row.label },
          confidence: 0.6,
          method: "merchant" as const,
        })),
      };
    }
    return { status: "not_found", reason: "Não achei esse lançamento na lista." };
  }

  const doTipo = rows.filter((r) => r.entityType === hint.entityType);
  if (doTipo.length === 1) {
    const row = doTipo[0]!;
    return {
      status: "resolved",
      entity: {
        entity: { id: row.entityId, type: row.entityType, label: row.label },
        confidence: 0.8,
        method: "anaphoric",
      },
    };
  }
  if (doTipo.length > 1) {
    return {
      status: "ambiguous",
      candidates: doTipo.map((row) => ({
        entity: { id: row.entityId, type: row.entityType, label: row.label },
        confidence: 0.5,
        method: "anaphoric" as const,
      })),
    };
  }
  return { status: "not_found", reason: "Não achei esse tipo na lista." };
}

function resultContextDe(
  query: QueryState,
  ids: string[],
  agora: number,
  data?: unknown,
): ResultContext {
  const visao = data as { tipo?: string; dados?: { totalDespesas?: number; dias?: Array<{ itens: Array<{ id: string; descricao: string; valor: number }> }> } } | undefined;
  const itens = visao?.dados?.dias?.flatMap((d) => d.itens) ?? [];
  const linhas = (itens.length > 0 ? itens : ids.map((id) => ({ id, descricao: id, valor: undefined as number | undefined }))).slice(0, 50);
  const rows = linhas
    .filter((item) => /^[0-9a-f-]{36}$/i.test(item.id))
    .map((item, i) => ({
      ordinal: i + 1,
      entityType: "transaction" as const,
      entityId: item.id,
      label: (item.descricao ?? "").trim() || "Lançamento",
      amount: typeof item.valor === "number" ? item.valor : undefined,
    }));
  return {
    queryHash: hashQuery(query),
    generatedAt: agora,
    stale: false,
    summary: { count: ids.length, total: visao?.dados?.totalDespesas },
    rows,
  };
}

function interpretConfirmacao(mensagem: string): "sim" | "nao" | "indice" | null {
  const t = mensagem.trim().toLocaleLowerCase("pt-BR");
  if (/^(sim|s|yes|ok|confirmo|confirma)\b/.test(t)) return "sim";
  if (/^(não|nao|n|no)\b/.test(t)) return "nao";
  if (/^\d+$/.test(t)) return "indice";
  return null;
}

function opDePlan(plan: ExecutionPlan): string {
  if (plan.type === "query") return "query";
  const tipo = plan.steps[0]?.command.type;
  if (tipo === "create_transaction" || tipo === "create_recurrence" || tipo === "create_rule") {
    return "create";
  }
  if (tipo === "update_transaction") return "update";
  if (tipo === "cancel_transaction") return "delete";
  return tipo ?? "unknown";
}

function comandoPrincipal(plan: ExecutionPlan): SimpleCommand | undefined {
  if (plan.type === "query") return { type: "query_transactions", spec: plan.spec };
  return plan.steps[0]?.command;
}

function idsDoResultado(result: { data?: unknown }): string[] {
  const ids = (result.data as { ids?: string[] } | undefined)?.ids ?? [];
  return ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
}

function textoAmbiguidades(lista: Ambiguity[]): string {
  const linhas = lista.map((a) => a.reason).filter(Boolean);
  return linhas.length > 0 ? `Preciso de um detalhe: ${linhas.join("; ")}.` : "Pode detalhar?";
}

function textoUnresolved(resolution: ResolutionResult): string {
  if (resolution.status === "ambiguous") {
    const lista = resolution.candidates.map((c, i) => `${i + 1}. ${c.entity.label}`).join("\n");
    return lista
      ? `Encontrei mais de um lançamento. Qual você quer?\n${lista}`
      : "Encontrei mais de um lançamento. Qual você quer?";
  }
  if (resolution.status === "not_found") {
    return resolution.reason || "Não encontrei esse lançamento.";
  }
  return "Não encontrei esse lançamento.";
}

function parsePendenciaExecucao(payload: unknown): { plan: ExecutionPlan; alvo?: EntityRef } | null {
  if (!payload || typeof payload !== "object") return null;
  const rec = payload as Record<string, unknown>;
  const planAninhado = ExecutionPlanSchema.safeParse(rec.plan);
  if (planAninhado.success) {
    const alvo = rec.alvo ? EntityRefSchema.safeParse(rec.alvo) : undefined;
    return { plan: planAninhado.data, alvo: alvo?.success ? alvo.data : undefined };
  }
  const direto = ExecutionPlanSchema.safeParse(payload);
  return direto.success ? { plan: direto.data } : null;
}

type ResultadoNomes =
  | { kind: "ok"; plan: ExecutionPlan }
  | { kind: "slot"; field: string; message: string }
  | { kind: "blocked"; message: string };

/**
 * Orquestra DialogueAct → QueryState → Relatórios (leitura) e Policy → Motor (escrita).
 * Não substitui o AssistenteCore v2.
 */
export class AssistenteCoreV3 {
  constructor(
    private readonly sessionManager: SessionManagerV3,
    private readonly extractor: ExtractorTurnoV3,
    private readonly resolver: ReferenceResolverV3,
    private readonly policyEngine: PolicyEngine,
    private readonly commandExecutor: CommandExecutor,
    private readonly responseGenerator: ResponseGenerator,
    private readonly catalogo: CatalogoNomesAssistente,
    private readonly opcoes: AssistenteCoreV3Opcoes = {},
  ) {}

  private agoraMs(): number {
    const n = this.opcoes.agoraMs?.() ?? Date.now();
    return n > 0 ? n : 1;
  }

  private dataAtual(): string {
    return this.opcoes.dataAtual?.() ?? hojeISO();
  }

  private async persistir(
    sessionId: string,
    ctx: ConversationContext,
    somenteLeitura: boolean,
  ): Promise<ConversationContext> {
    if (somenteLeitura) return ctx;
    const gravou = await this.sessionManager.atualizarEstado(sessionId, () => ctx);
    if (!gravou.ok) throw new Error(gravou.error);
    return gravou.value;
  }

  private async resolverNomesConsulta(
    query: QueryState,
    names: QueryNames | undefined,
    usuarioId: string,
  ): Promise<{ kind: "ok"; query: QueryState } | { kind: "slot"; field: string; message: string }> {
    let proximo = { ...query };
    if (names?.contaNome && !proximo.contaId) {
      const conta = await this.catalogo.buscarContaPorNome(usuarioId, names.contaNome);
      if (!conta) {
        return { kind: "slot", field: "account", message: `Não encontrei a conta ${names.contaNome}. Qual conta usar?` };
      }
      proximo.contaId = conta.id;
    }
    if (names?.cartaoNome && !proximo.cartaoId) {
      const cartao = await this.catalogo.buscarCartaoPorNome(usuarioId, names.cartaoNome);
      if (!cartao) {
        return { kind: "slot", field: "card", message: `Não encontrei o cartão ${names.cartaoNome}. Qual cartão usar?` };
      }
      proximo.cartaoId = cartao.id;
    }
    return { kind: "ok", query: proximo };
  }

  private async executarConsultaAct(
    act: Extract<DialogueAct, { act: "new_query" | "patch_query" | "change_grain" | "refresh" }>,
    sessionId: string,
    ctx: ConversationContext,
    input: AssistenteInput,
    traceId: string,
    somenteLeitura: boolean,
  ): Promise<AssistenteOutput> {
    let query: QueryState | null = ctx.query ?? null;
    let names: QueryNames | undefined;

    if (act.act === "new_query") {
      try {
        query = estadoConsultaNovo(act.query);
      } catch (erro) {
        if (erro instanceof ZodError) {
          await this.persistir(sessionId, ctx, somenteLeitura);
          return {
            resposta: "Não entendi o pedido. Pode reformular?",
            sessaoId: sessionId,
            traceId,
            diagnostico: { clarification: true, reason: "query_invalida" },
          };
        }
        throw erro;
      }
      names = act.names;
    } else if (act.act === "patch_query") {
      if (!query) {
        await this.persistir(sessionId, ctx, somenteLeitura);
        return {
          resposta: "Não tenho uma consulta anterior para complementar. Pode repetir o pedido completo?",
          sessaoId: sessionId,
          traceId,
          diagnostico: { clarification: true, reason: "sem_query" },
        };
      }
      try {
        query = applySlotOps(query, act.ops);
      } catch (erro) {
        if (erro instanceof ZodError) {
          await this.persistir(sessionId, ctx, somenteLeitura);
          return {
            resposta: "Não entendi o pedido. Pode reformular?",
            sessaoId: sessionId,
            traceId,
            diagnostico: { clarification: true, reason: "slot_invalido" },
          };
        }
        throw erro;
      }
      names = act.names;
    } else if (act.act === "change_grain") {
      if (!query) {
        query = estadoConsultaNovo({ grain: act.grain, sort: act.sort, limit: act.limit });
      } else {
        const ops: SlotOp[] = [{ op: "set", slot: "grain", value: act.grain }];
        if (act.sort) {
          ops.push({ op: "set", slot: "sort", value: act.sort });
        } else if (act.grain === "list" || act.grain === "summary") {
          ops.push({ op: "clear", slot: "sort" });
        }
        if (act.limit != null) {
          ops.push({ op: "set", slot: "limit", value: act.limit });
        } else if (act.grain === "list" || act.grain === "summary") {
          ops.push({ op: "clear", slot: "limit" });
        }
        query = applySlotOps(query, ops);
      }
    } else if (act.act === "refresh") {
      if (!query) {
        await this.persistir(sessionId, ctx, somenteLeitura);
        return {
          resposta: "Não tenho uma consulta para atualizar.",
          sessaoId: sessionId,
          traceId,
          diagnostico: { clarification: true, reason: "sem_query" },
        };
      }
    }

    if (!query) {
      await this.persistir(sessionId, ctx, somenteLeitura);
      return {
        resposta: "Não tenho uma consulta anterior para complementar. Pode repetir o pedido completo?",
        sessaoId: sessionId,
        traceId,
        diagnostico: { clarification: true, reason: "sem_query" },
      };
    }

    const resolvido = await this.resolverNomesConsulta(query, names, input.usuarioId);
    if (resolvido.kind === "slot") {
      return this.responderSlot(sessionId, { ...ctx, query }, resolvido, traceId, somenteLeitura);
    }
    query = resolvido.query;

    const spec = specCompiladoDe(query);
    const plan: ExecutionPlan = { type: "query", spec };
    let novoCtx: ConversationContext = { ...ctx, query };
    novoCtx = updateAfterPlan(novoCtx, plan, { agora: this.agoraMs() });
    novoCtx = { ...novoCtx, query };

    return this.seguirPlano(
      plan,
      sessionId,
      novoCtx,
      input.usuarioId,
      traceId,
      somenteLeitura,
      undefined,
      { confirmRequired: false, confirmed: false },
      input.mensagem,
      input.primeiroNome,
    );
  }

  async processar(input: AssistenteInput): Promise<AssistenteOutput> {
    const traceId = randomUUID();
    const somenteLeitura = Boolean(input.somenteLeitura);
    let sessaoId = input.sessaoId ?? "";

    try {
      const session = await this.sessionManager.obterOuCriar(input.usuarioId, input.canal, input.sessaoId, {
        persistir: !somenteLeitura,
      });
      sessaoId = session.id;

      if (input.canal === "whatsapp" && input.messageId && !somenteLeitura) {
        if (await this.sessionManager.jaProcessado(input.messageId)) {
          return { resposta: "Já processei essa mensagem.", sessaoId: session.id, traceId, duplicata: true };
        }
        await this.sessionManager.marcarProcessado(input.messageId, session.id);
      }

      let ctx = promoverQueryState(session.contexto);

      if (ctx.pending_action?.type === "confirmation") {
        const saida = await this.tratarConfirmacao(input, session.id, ctx, traceId, somenteLeitura);
        if (saida) return saida;
      }

      const historico = this.opcoes.carregarHistorico
        ? await this.opcoes.carregarHistorico(session.id)
        : [];

      let extraido: ExtracaoTurnoV3;
      try {
        extraido = await this.extractor.extract({
          mensagem: input.mensagem,
          context: ctx,
          historico,
          dataAtual: this.dataAtual(),
        });
      } catch (erro) {
        if (erro instanceof DialogueActInvalidoError) {
          await this.persistir(session.id, ctx, somenteLeitura);
          return {
            resposta: "Não entendi o pedido. Pode reformular?",
            sessaoId: session.id,
            traceId,
            diagnostico: { clarification: true, reason: "dialogue_act_invalido" },
          };
        }
        throw erro;
      }

      const extraidoAct = coerirDialogueActComContexto(extraido.act, ctx, {
        mensagem: input.mensagem,
        dataAtual: this.dataAtual(),
      });
      const act = extraidoAct;
      const understanding = extraido.understanding;

      if (act.act !== "confirm") {
        ctx = { ...ctx, pending_action: null };
      }
      if (understanding) {
        ctx = updateAfterUnderstanding(ctx, understanding, { agora: this.agoraMs() });
      }

      if (act.act === "greet") {
        await this.persistir(session.id, ctx, somenteLeitura);
        return {
          resposta: textoGreet(input.primeiroNome),
          sessaoId: session.id,
          traceId,
          diagnostico: { op: "greet" },
        };
      }

      if (act.act === "cancel") {
        const limpo: ConversationContext = { ...ctx, pending_action: null };
        await this.persistir(session.id, limpo, somenteLeitura);
        return {
          resposta: "Ok, cancelei.",
          sessaoId: session.id,
          traceId,
          diagnostico: { confirm: false, op: "delete" },
        };
      }

      if (act.act === "confirm" && ctx.pending_action?.type !== "confirmation") {
        return { resposta: "Não tenho nada para confirmar agora.", sessaoId: session.id, traceId };
      }

      if (understanding?.goal === "clarify") {
        const lista = [...(understanding.ambiguity ?? []), ...(understanding.question?.ambiguity ?? [])];
        await this.persistir(session.id, ctx, somenteLeitura);
        return {
          resposta: textoAmbiguidades(lista),
          sessaoId: session.id,
          traceId,
          diagnostico: { clarification: true, reason: "clarify" },
        };
      }

      if (ehActConsulta(act)) {
        return this.executarConsultaAct(act, session.id, ctx, input, traceId, somenteLeitura);
      }

      if (act.act === "diagnose") {
        await this.persistir(session.id, ctx, somenteLeitura);
        return {
          resposta: textoDiagnostico(act.suspicion, ctx),
          sessaoId: session.id,
          traceId,
          diagnostico: { op: "query", reason: act.suspicion ?? "query" },
        };
      }

      if (act.act === "refer_result") {
        if (act.hint.by === "ordinal_range") {
          const faixa = idsDaFaixaOrdinal(act.hint.de, act.hint.ate, ctx);
          if (faixa.length === 0) {
            await this.persistir(session.id, ctx, somenteLeitura);
            return {
              resposta: "Não achei esses itens na lista.",
              sessaoId: session.id,
              traceId,
              diagnostico: { blocked: true, reason: "not_found" },
            };
          }
          if (faixa.length === 1) {
            const item = faixa[0]!;
            ctx = updateAfterReferenceResolved(
              ctx,
              { id: item.id, type: "transaction", label: item.label },
              { agora: this.agoraMs() },
            );
            await this.persistir(session.id, ctx, somenteLeitura);
            return {
              resposta: `É o lançamento ${item.label}.`,
              sessaoId: session.id,
              traceId,
              diagnostico: { op: "query", executed: true },
            };
          }
          await this.persistir(session.id, ctx, somenteLeitura);
          return {
            resposta: faixa.map((item) => `${item.ordinal}. ${item.label}`).join("\n"),
            sessaoId: session.id,
            traceId,
            diagnostico: { op: "query", executed: true },
          };
        }
        const resolvido = resolverHintResultado(act.hint, ctx);
        if (resolvido.status === "ambiguous") {
          await this.persistir(session.id, ctx, somenteLeitura);
          return {
            resposta: textoUnresolved(resolvido),
            sessaoId: session.id,
            traceId,
            diagnostico: { clarification: true, blocked: true, reason: "ambiguous" },
          };
        }
        if (resolvido.status === "not_found") {
          await this.persistir(session.id, ctx, somenteLeitura);
          return {
            resposta: textoUnresolved(resolvido),
            sessaoId: session.id,
            traceId,
            diagnostico: { blocked: true, reason: "not_found" },
          };
        }
        ctx = updateAfterReferenceResolved(ctx, resolvido.entity.entity, { agora: this.agoraMs() });
        await this.persistir(session.id, ctx, somenteLeitura);
        return {
          resposta: `É o lançamento ${resolvido.entity.entity.label}.`,
          sessaoId: session.id,
          traceId,
          diagnostico: { op: "query", executed: true },
        };
      }

      if (act.act === "write" || act.act === "update" || act.act === "delete") {
        return this.executarComandoAct(act, extraido.understanding, session.id, ctx, input, traceId, somenteLeitura);
      }

      if (!understanding) {
        await this.persistir(session.id, ctx, somenteLeitura);
        return {
          resposta: "Não consegui entender. Pode reformular?",
          sessaoId: session.id,
          traceId,
          diagnostico: { blocked: true, reason: "unplanned" },
        };
      }

      const resolved = await this.resolverAlvo(understanding, ctx, input.usuarioId);
      if (resolved?.status === "resolved") {
        ctx = updateAfterReferenceResolved(ctx, resolved.entity.entity, { agora: this.agoraMs() });
      }

      const commandResult = planCommand(understanding, {
        resolved,
        dataAtual: this.dataAtual(),
      });

      if (!commandResult) {
        await this.persistir(session.id, ctx, somenteLeitura);
        return {
          resposta: "Não consegui entender. Pode reformular?",
          sessaoId: session.id,
          traceId,
          diagnostico: { blocked: true, reason: "unplanned" },
        };
      }

      if (commandResult.kind === "clarify") {
        await this.persistir(session.id, ctx, somenteLeitura);
        return {
          resposta: textoAmbiguidades(commandResult.ambiguity),
          sessaoId: session.id,
          traceId,
          diagnostico: { clarification: true, blocked: true, reason: "ambiguity" },
        };
      }

      if (commandResult.kind === "unresolved") {
        await this.persistir(session.id, ctx, somenteLeitura);
        return {
          resposta: textoUnresolved(commandResult.resolution),
          sessaoId: session.id,
          traceId,
          diagnostico: {
            blocked: true,
            clarification: commandResult.resolution.status === "ambiguous",
            reason: commandResult.resolution.status,
          },
        };
      }

      const alvo = resolved?.status === "resolved" ? resolved.entity.entity : ctx.focused_entity ?? undefined;
      const nomes = await this.preencherIdsPorNome(commandResult.plan, understanding, ctx, input.usuarioId);
      if (nomes.kind === "slot") {
        return this.responderSlot(session.id, ctx, nomes, traceId, somenteLeitura);
      }
      if (nomes.kind === "blocked") {
        return this.responderBloqueio(session.id, ctx, nomes.message, traceId, somenteLeitura);
      }

      return this.seguirPlano(
        nomes.plan,
        session.id,
        ctx,
        input.usuarioId,
        traceId,
        somenteLeitura,
        alvo,
        { confirmRequired: false, confirmed: false },
        input.mensagem,
        input.primeiroNome,
      );
    } catch (erro) {
      const message = erro instanceof Error ? erro.message : String(erro);
      console.error("[assistente-v3] turno falhou", { traceId, err: message });
      return {
        resposta: `Tive um problema interno. Código: ${traceId.slice(0, 8)}.`,
        sessaoId,
        traceId,
        diagnostico: { blocked: true, reason: message },
      };
    }
  }

  private alvoDoAct(
    act: Extract<DialogueAct, { act: "write" | "update" | "delete" }>,
    ctx: ConversationContext,
  ): ResolutionResult | undefined {
    if (act.act === "write") return undefined;
    if (act.target) return resolverHintResultado(act.target, ctx);
    if (ctx.focused_entity) {
      return {
        status: "resolved",
        entity: { entity: ctx.focused_entity, confidence: 0.9, method: "anaphoric" },
      };
    }
    return undefined;
  }

  private async executarComandoAct(
    act: Extract<DialogueAct, { act: "write" | "update" | "delete" }>,
    understanding: ConversationUnderstanding | undefined,
    sessionId: string,
    ctx: ConversationContext,
    input: AssistenteInput,
    traceId: string,
    somenteLeitura: boolean,
  ): Promise<AssistenteOutput> {
    if (act.act === "delete" && act.target?.by === "ordinal_range") {
      const faixa = idsDaFaixaOrdinal(act.target.de, act.target.ate, ctx);
      if (faixa.length === 0) {
        await this.persistir(sessionId, ctx, somenteLeitura);
        return {
          resposta: "Não achei esses itens na lista.",
          sessaoId: sessionId,
          traceId,
          diagnostico: { blocked: true, reason: "not_found" },
        };
      }
      const commandResult = planCancelarLancamentos(faixa.map((item) => item.id));
      if (!commandResult || commandResult.kind !== "plan") {
        await this.persistir(sessionId, ctx, somenteLeitura);
        return {
          resposta: "Não consegui entender. Pode reformular?",
          sessaoId: sessionId,
          traceId,
          diagnostico: { blocked: true, reason: "unplanned" },
        };
      }
      const primeiro = faixa[0]!;
      const alvoFaixa =
        faixa.length === 1
          ? { id: primeiro.id, type: "transaction" as const, label: primeiro.label }
          : {
              id: primeiro.id,
              type: "transaction" as const,
              label: `${faixa.length} lançamentos`,
            };
      return this.seguirPlano(
        commandResult.plan,
        sessionId,
        ctx,
        input.usuarioId,
        traceId,
        somenteLeitura,
        alvoFaixa,
        { confirmRequired: false, confirmed: false },
        input.mensagem,
        input.primeiroNome,
      );
    }

    let resolved = this.alvoDoAct(act, ctx);
    if ((!resolved || resolved.status !== "resolved") && understanding) {
      resolved = (await this.resolverAlvo(understanding, ctx, input.usuarioId)) ?? resolved;
    }
    if (resolved?.status === "resolved") {
      ctx = updateAfterReferenceResolved(ctx, resolved.entity.entity, { agora: this.agoraMs() });
    }

    const commandResult = understanding
      ? planCommand(understanding, { resolved, dataAtual: this.dataAtual() })
      : planCommandFromAct(act, { resolved, dataAtual: this.dataAtual() });

    if (!commandResult) {
      await this.persistir(sessionId, ctx, somenteLeitura);
      return {
        resposta: "Não consegui entender. Pode reformular?",
        sessaoId: sessionId,
        traceId,
        diagnostico: { blocked: true, reason: "unplanned" },
      };
    }

    if (commandResult.kind === "clarify") {
      await this.persistir(sessionId, ctx, somenteLeitura);
      return {
        resposta: textoAmbiguidades(commandResult.ambiguity),
        sessaoId: sessionId,
        traceId,
        diagnostico: { clarification: true, blocked: true, reason: "ambiguity" },
      };
    }

    if (commandResult.kind === "unresolved") {
      await this.persistir(sessionId, ctx, somenteLeitura);
      return {
        resposta: textoUnresolved(commandResult.resolution),
        sessaoId: sessionId,
        traceId,
        diagnostico: {
          blocked: true,
          clarification: commandResult.resolution.status === "ambiguous",
          reason: commandResult.resolution.status,
        },
      };
    }

    const alvo = resolved?.status === "resolved" ? resolved.entity.entity : ctx.focused_entity ?? undefined;
    const nomesWrite = act.act === "write" ? { contaNome: act.intent.contaNome, cartaoNome: act.intent.cartaoNome } : undefined;
    const nomes = await this.preencherIdsPorNome(commandResult.plan, understanding, ctx, input.usuarioId, nomesWrite);
    if (nomes.kind === "slot") {
      return this.responderSlot(sessionId, ctx, nomes, traceId, somenteLeitura);
    }
    if (nomes.kind === "blocked") {
      return this.responderBloqueio(sessionId, ctx, nomes.message, traceId, somenteLeitura);
    }

    return this.seguirPlano(
      nomes.plan,
      sessionId,
      ctx,
      input.usuarioId,
      traceId,
      somenteLeitura,
      alvo,
      { confirmRequired: false, confirmed: false },
      input.mensagem,
      input.primeiroNome,
    );
  }

  private async resolverAlvo(
    understanding: ConversationUnderstanding,
    ctx: ConversationContext,
    usuarioId: string,
  ): Promise<ResolutionResult | undefined> {
    const ref = understanding.continuation?.reference ?? understanding.explicit_references?.[0];
    if (ref) {
      return this.resolver.resolve(ref, ctx, { usuarioId, currentDate: this.dataAtual() }, this.agoraMs());
    }
    if (ctx.focused_entity) {
      return {
        status: "resolved",
        entity: { entity: ctx.focused_entity, confidence: 0.9, method: "anaphoric" },
      };
    }
    return undefined;
  }

  private avaliarPlano(plan: ExecutionPlan, alvo?: EntityRef): PolicyDecision {
    if (plan.type === "query") {
      return this.policyEngine.evaluateCommand({ type: "query_transactions", spec: plan.spec }, alvo);
    }
    let confirmMsg = "Confirmar operação?";
    let precisaConfirm = false;
    for (const step of plan.steps) {
      const decisao = this.policyEngine.evaluateCommand(step.command, alvo);
      if (!decisao.allowed) return decisao;
      if (decisao.confirm) {
        precisaConfirm = true;
        confirmMsg = decisao.message ?? confirmMsg;
      }
    }
    const cancelamentos = plan.steps.filter((s) => s.command.type === "cancel_transaction");
    if (precisaConfirm && cancelamentos.length > 1) {
      confirmMsg = `Cancelar ${cancelamentos.length} lançamentos? Ação irreversível.`;
    }
    if (precisaConfirm) {
      return {
        allowed: true,
        risk: "confirmation_required",
        confirm: true,
        reason: "risk",
        message: confirmMsg,
      };
    }
    return { allowed: true, risk: "none", confirm: false, reason: "auto" };
  }

  private async seguirPlano(
    plan: ExecutionPlan,
    sessionId: string,
    ctx: ConversationContext,
    usuarioId: string,
    traceId: string,
    somenteLeitura: boolean,
    alvo: EntityRef | undefined,
    confirmacao: { confirmRequired: boolean; confirmed: boolean },
    mensagem: string,
    primeiroNome?: string,
  ): Promise<AssistenteOutput> {
    const policy = this.avaliarPlano(plan, alvo);
    if (!policy.allowed) {
      await this.persistir(sessionId, ctx, somenteLeitura);
      return {
        resposta: policy.message ?? "Não posso fazer isso.",
        sessaoId: sessionId,
        traceId,
        diagnostico: {
          op: opDePlan(plan),
          blocked: true,
          reason: policy.reason,
        },
      };
    }

    if (policy.confirm && !confirmacao.confirmed) {
      const pending = {
        confirmationId: randomUUID(),
        requestHash: hashPlan(plan),
        stateVersion: ctx.version,
        message: policy.message ?? "Confirmar?",
        options: ["sim", "não"],
        expiresAt: this.agoraMs() + 15 * 60 * 1000,
        payload: { plan, alvo },
      };
      const novo: ConversationContext = {
        ...ctx,
        pending_action: { type: "confirmation", payload: pending },
      };
      await this.persistir(sessionId, novo, somenteLeitura);
      return {
        resposta: pending.message,
        sessaoId: sessionId,
        traceId,
        diagnostico: { confirm: true, op: opDePlan(plan) },
      };
    }

    return this.executar(plan, sessionId, ctx, usuarioId, traceId, somenteLeitura, alvo, {
      confirmRequired: confirmacao.confirmRequired || policy.confirm,
      confirmed: confirmacao.confirmed,
    }, mensagem, primeiroNome);
  }

  private async executar(
    plan: ExecutionPlan,
    sessionId: string,
    ctx: ConversationContext,
    usuarioId: string,
    traceId: string,
    somenteLeitura: boolean,
    alvo: EntityRef | undefined,
    confirmacao: { confirmRequired: boolean; confirmed: boolean },
    mensagem: string,
    primeiroNome?: string,
  ): Promise<AssistenteOutput> {
    if (somenteLeitura) {
      const resposta = prefixar_nota_dia_semana(
        this.responseGenerator.generateFromPlan({ success: true, data: {} }, plan),
        mensagem,
        this.dataAtual(),
      );
      return {
        resposta,
        sessaoId: sessionId,
        traceId,
        diagnostico: { op: opDePlan(plan), executed: false, reason: "shadow" },
      };
    }

    const result = await this.commandExecutor.executePlan(plan, {
      authenticatedUserId: usuarioId,
      sessionId,
      idempotencyKey: randomUUID(),
      traceId,
      stateVersion: ctx.version,
      primeiroNome,
      dataAtual: this.dataAtual(),
    });

    const comando = comandoPrincipal(plan);
    const resultIds = plan.type === "query" ? idsDoResultado(result) : undefined;
    let novoCtx = updateAfterExecution(ctx, result, {
      agora: this.agoraMs(),
      command: comando,
      resultIds,
    });
    if (plan.type === "query" && ctx.query && result.success) {
      novoCtx = {
        ...novoCtx,
        query: ctx.query,
        result: resultContextDe(
          ctx.query,
          resultIds ?? [],
          this.agoraMs(),
          (result.data as { data?: unknown } | undefined)?.data,
        ),
      };
    } else if (result.success && comando?.type !== "query_transactions" && novoCtx.result) {
      novoCtx = { ...novoCtx, result: { ...novoCtx.result, stale: true } };
    }
    await this.persistir(sessionId, novoCtx, false);

    const resposta = prefixar_nota_dia_semana(
      this.responseGenerator.generateFromPlan(result, plan),
      mensagem,
      this.dataAtual(),
    );
    const war = detectWrongAction({
      op: opDePlan(plan),
      executed: result.success,
      confirmRequired: confirmacao.confirmRequired || ["create", "update", "delete"].includes(opDePlan(plan)),
      confirmed: confirmacao.confirmed,
      targetFonte: typeof alvo?.metadata?.fonte === "string" ? alvo.metadata.fonte : undefined,
      fatoImutavel: alvo?.metadata?.fatoImutavel === true,
      requestedTargetId: alvo?.id,
      executedEntityId: result.entityRef?.id,
    });

    return {
      resposta,
      sessaoId: sessionId,
      traceId,
      diagnostico: {
        op: opDePlan(plan),
        executed: result.success,
        blocked: !result.success,
        war,
      },
    };
  }

  private async tratarConfirmacao(
    input: AssistenteInput,
    sessionId: string,
    ctx: ConversationContext,
    traceId: string,
    somenteLeitura: boolean,
  ): Promise<AssistenteOutput | null> {
    const parsed = ConfirmationRequestSchema.safeParse(ctx.pending_action?.payload);
    if (!parsed.success) return null;
    const pendente = parsed.data;
    if (pendente.expiresAt < this.agoraMs()) {
      const limpo: ConversationContext = { ...ctx, pending_action: null };
      await this.persistir(sessionId, limpo, somenteLeitura);
      return { resposta: "A confirmação expirou. Pode repetir o pedido.", sessaoId: sessionId, traceId };
    }

    const tipo = interpretConfirmacao(input.mensagem);
    if (tipo === null) return null;
    if (tipo === "nao") {
      const limpo: ConversationContext = { ...ctx, pending_action: null };
      await this.persistir(sessionId, limpo, somenteLeitura);
      return {
        resposta: "Ok, cancelei.",
        sessaoId: sessionId,
        traceId,
        diagnostico: { confirm: false, op: "delete" },
      };
    }
    if (tipo === "indice") return null;

    const execucao = parsePendenciaExecucao(pendente.payload);
    if (!execucao) {
      const limpo: ConversationContext = { ...ctx, pending_action: null };
      await this.persistir(sessionId, limpo, somenteLeitura);
      return { resposta: "Perdi o contexto da confirmação. Pode repetir?", sessaoId: sessionId, traceId };
    }

    const semPendente: ConversationContext = { ...ctx, pending_action: null };
    return this.executar(
      execucao.plan,
      sessionId,
      semPendente,
      input.usuarioId,
      traceId,
      somenteLeitura,
      execucao.alvo,
      { confirmRequired: true, confirmed: true },
      input.mensagem,
      input.primeiroNome,
    );
  }

  private async responderBloqueio(
    sessionId: string,
    ctx: ConversationContext,
    message: string,
    traceId: string,
    somenteLeitura: boolean,
  ): Promise<AssistenteOutput> {
    await this.persistir(sessionId, ctx, somenteLeitura);
    return {
      resposta: message,
      sessaoId: sessionId,
      traceId,
      diagnostico: { blocked: true, reason: "of_synced" },
    };
  }

  private async responderSlot(
    sessionId: string,
    ctx: ConversationContext,
    slot: Extract<ResultadoNomes, { kind: "slot" }>,
    traceId: string,
    somenteLeitura: boolean,
  ): Promise<AssistenteOutput> {
    const novo: ConversationContext = {
      ...ctx,
      pending_action: { type: "slot_fill", payload: { field: slot.field, message: slot.message } },
    };
    await this.persistir(sessionId, novo, somenteLeitura);
    return {
      resposta: slot.message,
      sessaoId: sessionId,
      traceId,
      diagnostico: { clarification: true, reason: "slot_fill" },
    };
  }

  private async preencherIdsPorNome(
    plan: ExecutionPlan,
    understanding: ConversationUnderstanding | undefined,
    ctx: ConversationContext,
    usuarioId: string,
    nomesWrite?: { contaNome?: string; cartaoNome?: string },
  ): Promise<ResultadoNomes> {
    if (plan.type === "query") {
      const spec = { ...plan.spec };
      if (spec.contaNome && !spec.contaId) {
        const conta = await this.catalogo.buscarContaPorNome(usuarioId, spec.contaNome);
        if (conta) spec.contaId = conta.id;
      }
      if (spec.cartaoNome && !spec.cartaoId) {
        const cartao = await this.catalogo.buscarCartaoPorNome(usuarioId, spec.cartaoNome);
        if (cartao) spec.cartaoId = cartao.id;
      }
      return { kind: "ok", plan: { ...plan, spec } };
    }

    const steps = [];
    for (const step of plan.steps) {
      const command = structuredClone(step.command);
      if (command.type === "create_transaction" || command.type === "create_recurrence") {
        const preenchido = await this.resolverContaCartao(command, understanding, ctx, usuarioId, nomesWrite);
        if (preenchido.kind === "slot" || preenchido.kind === "blocked") return preenchido;
        steps.push({ ...step, command: preenchido.command });
      } else {
        steps.push({ ...step, command });
      }
    }
    return { kind: "ok", plan: { type: "command", steps } };
  }

  private async resolverContaCartao(
    command: Extract<SimpleCommand, { type: "create_transaction" | "create_recurrence" }>,
    understanding: ConversationUnderstanding | undefined,
    ctx: ConversationContext,
    usuarioId: string,
    nomesWrite?: { contaNome?: string; cartaoNome?: string },
  ): Promise<
    | { kind: "ok"; command: SimpleCommand }
    | Extract<ResultadoNomes, { kind: "slot" }>
    | Extract<ResultadoNomes, { kind: "blocked" }>
  > {
    const nomeCartao = nomesWrite?.cartaoNome ?? understanding?.question?.entities?.card;
    const nomeConta = nomesWrite?.contaNome ?? understanding?.question?.entities?.account;
    const ehPagamentoFatura =
      command.type === "create_transaction" && command.input.papel === "pagamento_fatura";

    if (ehPagamentoFatura) {
      return this.resolverPagamentoFatura(command, usuarioId, nomeCartao, nomeConta);
    }

    if (command.input.contaId || command.input.cartaoId) {
      return { kind: "ok", command };
    }

    if (nomeCartao) {
      const cartao = await this.catalogo.buscarCartaoPorNome(usuarioId, nomeCartao);
      if (!cartao) {
        return {
          kind: "slot",
          field: "card",
          message: `Não encontrei o cartão ${nomeCartao}. Qual cartão usar?`,
        };
      }
      command.input.cartaoId = cartao.id;
      return { kind: "ok", command };
    }

    if (nomeConta) {
      const conta = await this.catalogo.buscarContaPorNome(usuarioId, nomeConta);
      if (!conta) {
        return {
          kind: "slot",
          field: "account",
          message: `Não encontrei a conta ${nomeConta}. Qual conta usar?`,
        };
      }
      command.input.contaId = conta.id;
      return { kind: "ok", command };
    }

    const defaultCard = ctx.user_preferences?.defaultCardId ?? ctx.topic_preferences?.default_card?.id;
    const defaultConta = ctx.user_preferences?.defaultAccountId ?? ctx.topic_preferences?.default_account?.id;
    if (defaultCard) {
      command.input.cartaoId = defaultCard;
      return { kind: "ok", command };
    }
    if (defaultConta) {
      command.input.contaId = defaultConta;
      return { kind: "ok", command };
    }

    return {
      kind: "slot",
      field: "account",
      message: "Qual conta usar para este lançamento?",
    };
  }

  private async resolverPagamentoFatura(
    command: Extract<SimpleCommand, { type: "create_transaction" }>,
    usuarioId: string,
    nomeCartao: string | undefined,
    nomeConta: string | undefined,
  ): Promise<
    | { kind: "ok"; command: SimpleCommand }
    | Extract<ResultadoNomes, { kind: "slot" }>
    | Extract<ResultadoNomes, { kind: "blocked" }>
  > {
    if (!nomeCartao) {
      return { kind: "slot", field: "card", message: "Qual cartão é a fatura?" };
    }

    const cartao = await this.catalogo.buscarCartaoPorNome(usuarioId, nomeCartao);
    if (!cartao) {
      return {
        kind: "slot",
        field: "card",
        message: `Não encontrei o cartão ${nomeCartao}. Qual cartão usar?`,
      };
    }

    let conta: OrigemCatalogoAssistente | null = null;
    if (nomeConta) {
      conta = await this.catalogo.buscarContaPorNome(usuarioId, nomeConta);
      if (!conta) {
        return {
          kind: "slot",
          field: "account",
          message: `Não encontrei a conta ${nomeConta}. Qual conta usar?`,
        };
      }
    }

    const origemSync = cartao.sincronizada ? cartao : conta?.sincronizada ? conta : null;
    if (origemSync) {
      return {
        kind: "blocked",
        message: `"${origemSync.nome}" está conectada ao banco, então o lançamento vem de lá. Quando cair no extrato, me chame que eu classifico.`,
      };
    }

    if (conta) {
      command.input.contaId = conta.id;
      command.input.cartaoFaturaId = cartao.id;
      delete command.input.cartaoId;
    } else {
      command.input.cartaoId = cartao.id;
      command.input.cartaoFaturaId = cartao.id;
    }
    return { kind: "ok", command };
  }
}
