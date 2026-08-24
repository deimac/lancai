import { createHash, randomUUID } from "node:crypto";
import {
  ConfirmationRequestSchema,
  EntityRefSchema,
  ExecutionPlanSchema,
  hojeISO,
  type Ambiguity,
  type ConversationContext,
  type ConversationUnderstanding,
  type EntityRef,
  type ExecutionPlan,
  type PolicyDecision,
  type ResolutionResult,
  type SimpleCommand,
} from "@lancai/tipos";
import type { AssistenteInput, AssistenteOutput } from "./assistente-core";
import { CommandExecutor } from "./command-executor";
import { planCommand } from "./command-planner";
import {
  updateAfterExecution,
  updateAfterNeed,
  updateAfterPlan,
  updateAfterReferenceResolved,
  updateAfterUnderstanding,
} from "./context-updater";
import { PolicyEngine } from "./policy-engine";
import { planQuery } from "./query-planner";
import { ReferenceResolverV3 } from "./reference-resolver-v3";
import { ResponseGenerator } from "./response-generator";
import { SessionManagerV3 } from "./session-manager-v3";
import type { UnderstandingExtractor } from "./understanding-extractor";
import { understandingToNeed } from "./understanding-to-need";
import { detectWrongAction } from "./war-detector";
import type { TurnoUnderstanding } from "../prompts/understanding";

export type CatalogoNomesAssistente = {
  buscarContaPorNome(usuarioId: string, nome: string): Promise<{ id: string; nome: string } | null>;
  buscarCartaoPorNome(usuarioId: string, nome: string): Promise<{ id: string; nome: string } | null>;
};

export type AssistenteCoreV3Opcoes = {
  carregarHistorico?: (sessaoId: string) => Promise<TurnoUnderstanding[]>;
  agoraMs?: () => number;
  dataAtual?: () => string;
};

const TEXTO_GREET =
  "Olá! Posso lançar gastos, consultar extrato ou corrigir um lançamento.";

function hashPlan(plan: ExecutionPlan): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex").slice(0, 32);
}

function interpretConfirmacao(mensagem: string): "sim" | "nao" | "indice" | null {
  const t = mensagem.trim().toLocaleLowerCase("pt-BR");
  if (/^(sim|s|yes|ok|confirmo)$/.test(t)) return "sim";
  if (/^(não|nao|n|no)$/.test(t)) return "nao";
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
  | { kind: "slot"; field: string; message: string };

/**
 * Orquestra Understanding → Need → Plan → Policy → Execute (Assistente 2.0 definitivo).
 * Não substitui o AssistenteCore v2.
 */
export class AssistenteCoreV3 {
  constructor(
    private readonly sessionManager: SessionManagerV3,
    private readonly extractor: Pick<UnderstandingExtractor, "extract">,
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

  async processar(input: AssistenteInput): Promise<AssistenteOutput> {
    const traceId = randomUUID();
    const somenteLeitura = Boolean(input.somenteLeitura);

    const session = await this.sessionManager.obterOuCriar(input.usuarioId, input.canal, input.sessaoId, {
      persistir: !somenteLeitura,
    });

    if (input.canal === "whatsapp" && input.messageId && !somenteLeitura) {
      if (await this.sessionManager.jaProcessado(input.messageId)) {
        return { resposta: "Já processei essa mensagem.", sessaoId: session.id, traceId, duplicata: true };
      }
      await this.sessionManager.marcarProcessado(input.messageId, session.id);
    }

    let ctx = session.contexto;

    try {
      if (ctx.pending_action?.type === "confirmation") {
        const saida = await this.tratarConfirmacao(input, session.id, ctx, traceId, somenteLeitura);
        if (saida) return saida;
      }

      const historico = this.opcoes.carregarHistorico
        ? await this.opcoes.carregarHistorico(session.id)
        : [];

      const understanding = await this.extractor.extract({
        mensagem: input.mensagem,
        context: ctx,
        historico,
        dataAtual: this.dataAtual(),
      });

      if (understanding.goal !== "confirm") {
        ctx = { ...ctx, pending_action: null };
      }
      ctx = updateAfterUnderstanding(ctx, understanding, { agora: this.agoraMs() });

      if (understanding.goal === "greet") {
        await this.persistir(session.id, ctx, somenteLeitura);
        return { resposta: TEXTO_GREET, sessaoId: session.id, traceId, diagnostico: { op: "greet" } };
      }

      if (understanding.goal === "clarify") {
        const lista = [...(understanding.ambiguity ?? []), ...(understanding.question?.ambiguity ?? [])];
        await this.persistir(session.id, ctx, somenteLeitura);
        return {
          resposta: textoAmbiguidades(lista),
          sessaoId: session.id,
          traceId,
          diagnostico: { clarification: true, reason: "clarify" },
        };
      }

      if (understanding.goal === "confirm" && ctx.pending_action?.type !== "confirmation") {
        return { resposta: "Não tenho nada para confirmar agora.", sessaoId: session.id, traceId };
      }

      const need = understandingToNeed(understanding, ctx, { dataAtual: this.dataAtual() });
      if (need) {
        ctx = updateAfterNeed(ctx, need, { agora: this.agoraMs() });
        const plan = planQuery(need, ctx);
        ctx = updateAfterPlan(ctx, plan, { agora: this.agoraMs(), need });
        const nomes = await this.preencherIdsPorNome(plan, understanding, ctx, input.usuarioId);
        if (nomes.kind === "slot") {
          return this.responderSlot(session.id, ctx, nomes, traceId, somenteLeitura);
        }
        return this.seguirPlano(nomes.plan, session.id, ctx, input.usuarioId, traceId, somenteLeitura, undefined, {
          confirmRequired: false,
          confirmed: false,
        });
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

      return this.seguirPlano(nomes.plan, session.id, ctx, input.usuarioId, traceId, somenteLeitura, alvo, {
        confirmRequired: false,
        confirmed: false,
      });
    } catch (erro) {
      const message = erro instanceof Error ? erro.message : String(erro);
      return {
        resposta: `Tive um problema interno. Código: ${traceId.slice(0, 8)}.`,
        sessaoId: session.id,
        traceId,
        diagnostico: { blocked: true, reason: message },
      };
    }
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
        expiresAt: this.agoraMs() + 5 * 60 * 1000,
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
    });
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
  ): Promise<AssistenteOutput> {
    if (somenteLeitura) {
      const resposta = this.responseGenerator.generateFromPlan({ success: true, data: {} }, plan);
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
    });

    const comando = comandoPrincipal(plan);
    const resultIds = plan.type === "query" ? idsDoResultado(result) : undefined;
    const novoCtx = updateAfterExecution(ctx, result, {
      agora: this.agoraMs(),
      command: comando,
      resultIds,
    });
    await this.persistir(sessionId, novoCtx, false);

    const resposta = this.responseGenerator.generateFromPlan(result, plan);
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
    return this.executar(execucao.plan, sessionId, semPendente, input.usuarioId, traceId, somenteLeitura, execucao.alvo, {
      confirmRequired: true,
      confirmed: true,
    });
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
    understanding: ConversationUnderstanding,
    ctx: ConversationContext,
    usuarioId: string,
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
        const preenchido = await this.resolverContaCartao(command, understanding, ctx, usuarioId);
        if (preenchido.kind === "slot") return preenchido;
        steps.push({ ...step, command: preenchido.command });
      } else {
        steps.push({ ...step, command });
      }
    }
    return { kind: "ok", plan: { type: "command", steps } };
  }

  private async resolverContaCartao(
    command: Extract<SimpleCommand, { type: "create_transaction" | "create_recurrence" }>,
    understanding: ConversationUnderstanding,
    ctx: ConversationContext,
    usuarioId: string,
  ): Promise<{ kind: "ok"; command: SimpleCommand } | Extract<ResultadoNomes, { kind: "slot" }>> {
    if (command.input.contaId || command.input.cartaoId) {
      return { kind: "ok", command };
    }

    const nomeCartao = understanding.question?.entities?.card;
    const nomeConta = understanding.question?.entities?.account;

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
}
