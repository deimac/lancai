import { createHash, randomUUID } from "node:crypto";
import type { ConversationState, ResolvedRequest, UserRequest } from "@lancai/tipos";
import { ResolvedRequestSchema } from "@lancai/tipos";
import { SessionManager } from "./session-manager";
import { SemanticParserV2 } from "./semantic-parser-v2";
import { ReferenceResolver } from "./reference-resolver";
import { PolicyEngine } from "./policy-engine";
import { CommandExecutor } from "./command-executor";
import { StateUpdater } from "./state-updater";
import { ResponseGenerator } from "./response-generator";
import { detectWrongAction } from "./war-detector";

export type FeatureFlagsAssistente = {
  ASSISTENTE_V2_SHADOW?: boolean;
  ASSISTENTE_V2_ASSISTANT?: boolean;
};

export interface AssistenteInput {
  usuarioId: string;
  mensagem: string;
  sessaoId?: string;
  canal: "web" | "whatsapp";
  messageId?: string;
  intencaoPrevia?: Partial<UserRequest>;
}

export interface AssistenteOutput {
  resposta: string;
  sessaoId: string;
  traceId: string;
  /** Só para testes/WAR: o que o v2 decidiu neste turno. */
  diagnostico?: {
    op?: string;
    blocked?: boolean;
    confirm?: boolean;
    clarification?: boolean;
    executed?: boolean;
    reason?: string;
    war?: string | null;
  };
  /** WhatsApp: messageId já visto — não gravar de novo no histórico. */
  duplicata?: boolean;
}

export type ShadowLogger = (evento: Record<string, unknown>) => void;

function hashRequest(request: ResolvedRequest): string {
  return createHash("sha256").update(JSON.stringify(request)).digest("hex").slice(0, 32);
}

function interpretConfirmacao(mensagem: string): "sim" | "nao" | "indice" | null {
  const t = mensagem.trim().toLocaleLowerCase("pt-BR");
  if (/^(sim|s|yes|ok|confirmo)$/.test(t)) return "sim";
  if (/^(não|nao|n|no)$/.test(t)) return "nao";
  if (/^\d+$/.test(t)) return "indice";
  return null;
}

/**
 * Orquestra Session → Parser → Resolver → Policy → Execute → State → Resposta.
 */
export class AssistenteCore {
  constructor(
    private readonly sessionManager: SessionManager,
    private readonly semanticParser: SemanticParserV2,
    private readonly referenceResolver: ReferenceResolver,
    private readonly policyEngine: PolicyEngine,
    private readonly commandExecutor: CommandExecutor,
    private readonly stateUpdater: StateUpdater,
    private readonly responseGenerator: ResponseGenerator,
    private readonly featureFlags: FeatureFlagsAssistente = {},
    private readonly shadowLog: ShadowLogger = () => undefined,
    private readonly gerarMenu?: (usuarioId: string) => Promise<string> | string,
  ) {}

  async processar(input: AssistenteInput): Promise<AssistenteOutput> {
    const traceId = randomUUID();
    const session = await this.sessionManager.obterOuCriar(input.usuarioId, input.canal, input.sessaoId);

    if (input.canal === "whatsapp" && input.messageId) {
      if (await this.sessionManager.jaProcessado(input.messageId)) {
        return { resposta: "Já processei essa mensagem.", sessaoId: session.id, traceId, duplicata: true };
      }
      await this.sessionManager.marcarProcessado(input.messageId, session.id);
    }

    let state = session.contexto;

    try {
      if (state.pendingConfirmation) {
        const saida = await this.tratarConfirmacao(input, session.id, state, traceId);
        if (saida) return saida;
      }

      const parseResult = await this.semanticParser.parse({
        mensagem: input.mensagem,
        state,
        userId: input.usuarioId,
        canal: input.canal,
        intencaoPrevia: input.intencaoPrevia,
      });

      if (this.featureFlags.ASSISTENTE_V2_SHADOW) {
        this.shadowLog({
          traceId,
          shadow: true,
          v2: { request: parseResult.request, shortcut: parseResult.shortcutName },
        });
      }

      if (parseResult.shortcutName === "menu") {
        const resposta = this.gerarMenu
          ? await this.gerarMenu(input.usuarioId)
          : "Posso lançar gastos, consultar extrato, corrigir um lançamento ou criar recorrência. É só falar.";
        return { resposta, sessaoId: session.id, traceId };
      }

      if (parseResult.shortcutName === "confirmacao" && !state.pendingConfirmation) {
        return { resposta: "Não tenho nada para confirmar agora.", sessaoId: session.id, traceId };
      }

      const resolved = await this.referenceResolver.resolveRequest(parseResult.request, state, {
        usuarioId: input.usuarioId,
      });

      if (resolved.resolved.target && parseResult.request.op !== "query") {
        state = this.stateUpdater.updateAfterReferenceResolved(state, resolved.resolved.target);
      }

      const policy = this.policyEngine.evaluate(resolved, state);

      if (!policy.allowed) {
        if (policy.reason === "ambiguity") {
          const candidatos =
            (resolved.resolved.target?.metadata?.candidates as Array<{ entity: { label: string } }> | undefined) ?? [];
          const lista =
            candidatos.length > 0
              ? candidatos.map((c, i) => `${i + 1}. ${c.entity.label}`).join("\n")
              : "1. …\n2. …";
          return {
            resposta: `${policy.message ?? "Qual deles?"}\n${lista}`,
            sessaoId: session.id,
            traceId,
            diagnostico: { blocked: true, clarification: true, reason: policy.reason, op: resolved.request.op },
          };
        }
        return {
          resposta: policy.message ?? "Não posso fazer isso.",
          sessaoId: session.id,
          traceId,
          diagnostico: { blocked: true, reason: policy.reason, op: resolved.request.op },
        };
      }

      if (policy.confirm) {
        const confirmationId = randomUUID();
        const pending = {
          confirmationId,
          requestHash: hashRequest(resolved),
          stateVersion: state.version,
          message: policy.message ?? "Confirmar?",
          options: ["sim", "não"],
          expiresAt: Date.now() + 5 * 60 * 1000,
          payload: resolved,
        };
        const novo = { ...state, version: state.version + 1, pendingConfirmation: pending };
        const gravou = await this.sessionManager.atualizarEstado(session.id, () => novo);
        if (!gravou.ok) {
          return {
            resposta: `Não consegui gravar a confirmação. Código: ${traceId.slice(0, 8)}.`,
            sessaoId: session.id,
            traceId,
            diagnostico: { confirm: true, blocked: true, reason: gravou.error, op: resolved.request.op },
          };
        }
        return {
          resposta: pending.message,
          sessaoId: session.id,
          traceId,
          diagnostico: { confirm: true, op: resolved.request.op },
        };
      }

      return await this.executar(resolved, session.id, state, input.usuarioId, traceId, {
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

  private async tratarConfirmacao(
    input: AssistenteInput,
    sessionId: string,
    state: ConversationState,
    traceId: string,
  ): Promise<AssistenteOutput | null> {
    const pendente = state.pendingConfirmation;
    if (!pendente) return null;
    if (pendente.expiresAt < Date.now()) {
      const limpo = this.stateUpdater.clearPendingConfirmation(state);
      await this.sessionManager.atualizarEstado(sessionId, () => limpo);
      return { resposta: "A confirmação expirou. Pode repetir o pedido.", sessaoId: sessionId, traceId };
    }
    const tipo = interpretConfirmacao(input.mensagem);
    if (tipo === null) return null;
    if (tipo === "nao") {
      const limpo = this.stateUpdater.updateAfterConfirmation(state, false);
      await this.sessionManager.atualizarEstado(sessionId, () => limpo);
      return { resposta: "Ok, cancelei.", sessaoId: sessionId, traceId, diagnostico: { confirm: false, op: "delete" } };
    }
    if (tipo === "indice") {
      return null;
    }
    const parsed = ResolvedRequestSchema.safeParse(pendente.payload);
    if (!parsed.success) {
      const limpo = this.stateUpdater.clearPendingConfirmation(state);
      await this.sessionManager.atualizarEstado(sessionId, () => limpo);
      return { resposta: "Perdi o contexto da confirmação. Pode repetir?", sessaoId: sessionId, traceId };
    }
    const semPendente = this.stateUpdater.updateAfterConfirmation(state, true);
    return this.executar(parsed.data, sessionId, semPendente, input.usuarioId, traceId, {
      confirmRequired: true,
      confirmed: true,
    });
  }

  private async executar(
    resolved: ResolvedRequest,
    sessionId: string,
    state: ConversationState,
    usuarioId: string,
    traceId: string,
    confirmacao: { confirmRequired: boolean; confirmed: boolean },
  ): Promise<AssistenteOutput> {
    const result = await this.commandExecutor.execute(
      resolved.request,
      {
        authenticatedUserId: usuarioId,
        sessionId,
        idempotencyKey: randomUUID(),
        traceId,
        stateVersion: state.version,
      },
      resolved.resolved.target?.id,
      {
        accountId: resolved.resolved.account?.id,
        cardId: resolved.resolved.card?.id,
        categoryId: resolved.resolved.category?.id,
      },
    );

    const comando = this.commandExecutor.montarComando(resolved.request, resolved.resolved.target?.id);
    let novoState = state;
    if (comando.ok && comando.value.type === "query_transactions") {
      const ids = ((result.data as { ids?: string[] } | undefined)?.ids ?? []).filter((id) =>
        /^[0-9a-f-]{36}$/i.test(id),
      );
      novoState = this.stateUpdater.updateAfterQuery(state, comando.value.spec, ids);
    } else if (comando.ok) {
      novoState = this.stateUpdater.updateAfterCommand(state, comando.value, result);
    }
    await this.sessionManager.atualizarEstado(sessionId, () => novoState);

    const resposta = this.responseGenerator.generate(result, novoState, resolved);
    const war = detectWrongAction({
      op: resolved.request.op,
      executed: result.success,
      confirmRequired: confirmacao.confirmRequired || ["create", "update", "delete"].includes(resolved.request.op),
      confirmed: confirmacao.confirmed,
      targetFonte: typeof resolved.resolved.target?.metadata?.fonte === "string"
        ? resolved.resolved.target.metadata.fonte
        : undefined,
      fatoImutavel: resolved.resolved.target?.metadata?.fatoImutavel === true,
      requestedTargetId: resolved.resolved.target?.id,
      executedEntityId: result.entityRef?.id,
    });
    return {
      resposta,
      sessaoId: sessionId,
      traceId,
      diagnostico: {
        op: resolved.request.op,
        executed: result.success,
        blocked: !result.success,
        war,
      },
    };
  }
}
