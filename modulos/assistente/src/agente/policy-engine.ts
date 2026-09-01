import type {
  ConversationState,
  EntityRef,
  PolicyDecision,
  ResolvedRequest,
  SimpleCommand,
  UserRequest,
} from "@lancai/tipos";

const FATO_FIELDS = new Set([
  "valor",
  "dataMovimento",
  "contaId",
  "cartaoId",
  "tipo",
  "descricaoFonte",
  "formaPagamento",
  "parcelamento",
]);

function ehOF(request: ResolvedRequest): boolean {
  const meta = request.resolved.target?.metadata;
  return meta?.fatoImutavel === true || meta?.fonte === "open_finance";
}

function temCampoFato(params: UserRequest["params"]): boolean {
  return Object.keys(params).some((k) => FATO_FIELDS.has(k) && params[k] !== undefined);
}

function temFatoPatch(command: SimpleCommand): boolean {
  if (command.type !== "update_transaction") return false;
  const patch = command.input.fatoPatch;
  if (!patch) return false;
  return Object.entries(patch).some(([chave, valor]) => FATO_FIELDS.has(chave) && valor !== undefined);
}

function formatarTransacao(params: UserRequest["params"]): string {
  const valor = typeof params.valor === "number" ? `R$ ${params.valor}` : "";
  const desc = typeof params.descricao === "string" ? params.descricao : "lançamento";
  return `${desc} ${valor}`.trim();
}

/**
 * Policy determinística: OF bloqueia; resto confirma writes; query/classify passam.
 */
export class PolicyEngine {
  evaluate(request: ResolvedRequest, _state?: ConversationState): PolicyDecision {
    const precisaAlvo = request.request.op === "update" || request.request.op === "delete";
    const alvoAmbiguo = request.resolved.target?.metadata?.status === "ambiguous";
    if (precisaAlvo && (alvoAmbiguo || !request.resolved.target)) {
      return {
        allowed: false,
        risk: "blocked",
        confirm: false,
        reason: "ambiguity",
        message: "Encontrei mais de um lançamento. Qual você quer?",
      };
    }

    if (request.request.op === "update" && request.request.resource === "transaction" && ehOF(request) && temCampoFato(request.request.params)) {
      return {
        allowed: false,
        risk: "blocked",
        confirm: false,
        reason: "of_fato_immutable",
        message:
          "Esse lançamento veio do banco. Não posso alterar o fato financeiro, só classificar/complementar.",
      };
    }

    if (request.request.op === "delete" && request.request.resource === "transaction" && ehOF(request)) {
      return {
        allowed: false,
        risk: "blocked",
        confirm: false,
        reason: "of_cannot_delete",
        message:
          "Esse lançamento veio do banco. Não posso apagar. Posso marcar 'não considera nos relatórios'.",
      };
    }

    const risk = this.classifyRisk(request.request);
    if (risk === "none") {
      return { allowed: true, risk: "none", confirm: false, reason: "auto" };
    }
    return {
      allowed: true,
      risk,
      confirm: true,
      reason: "risk",
      message: this.mensagemConfirmacao(request),
    };
  }

  /**
   * Policy sobre SimpleCommand (Core V3). `evaluate(ResolvedRequest)` do v2 permanece intacto.
   * Query: risk none. Writes: confirmam. OF fato/delete: blocked.
   */
  evaluateCommand(command: SimpleCommand, alvo?: EntityRef): PolicyDecision {
    if (command.type === "query_transactions") {
      return { allowed: true, risk: "none", confirm: false, reason: "auto" };
    }

    const of = alvo?.metadata?.fatoImutavel === true || alvo?.metadata?.fonte === "open_finance";

    if (command.type === "update_transaction" && of && temFatoPatch(command)) {
      return {
        allowed: false,
        risk: "blocked",
        confirm: false,
        reason: "of_fato_immutable",
        message:
          "Esse lançamento veio do banco. Não posso alterar o fato financeiro, só classificar/complementar.",
      };
    }

    if (command.type === "cancel_transaction" && of) {
      return {
        allowed: false,
        risk: "blocked",
        confirm: false,
        reason: "of_cannot_delete",
        message:
          "Esse lançamento veio do banco. Não posso apagar. Posso marcar 'não considera nos relatórios'.",
      };
    }

    return {
      allowed: true,
      risk: "confirmation_required",
      confirm: true,
      reason: "risk",
      message: this.mensagemConfirmacaoComando(command, alvo),
    };
  }

  private classifyRisk(request: UserRequest): PolicyDecision["risk"] {
    if (request.op === "query" || request.op === "classify") return "none";
    return "confirmation_required";
  }

  private mensagemConfirmacao(request: ResolvedRequest): string {
    const label = request.resolved.target?.label || "lançamento";
    switch (request.request.op) {
      case "create":
        if (request.request.resource === "recurrence") {
          return `Criar recorrência: ${formatarTransacao(request.request.params)}. Confirmar?`;
        }
        if (request.request.resource === "rule") {
          return `Criar regra: ${String(request.request.params.merchant ?? "")}. Confirmar?`;
        }
        return `Confirmar: ${formatarTransacao(request.request.params)}?`;
      case "update":
        return `Alterar ${label}. Confirmar?`;
      case "delete":
        return `Cancelar ${label}? Ação irreversível.`;
      default:
        return "Confirmar operação?";
    }
  }

  private mensagemConfirmacaoComando(command: SimpleCommand, alvo?: EntityRef): string {
    const label = alvo?.label || "lançamento";
    switch (command.type) {
      case "create_transaction":
        return `Ainda não gravei. Confirmar lançamento: ${formatarTransacao({
          descricao: command.input.descricao,
          valor: command.input.valor,
        })}${command.input.dataMovimento ? ` em ${command.input.dataMovimento}` : ""}? Responda sim.`;
      case "create_recurrence":
        return `Criar recorrência: ${formatarTransacao({
          descricao: command.input.descricao,
          valor: command.input.valor,
        })}. Confirmar?`;
      case "create_rule":
        return `Criar regra: ${command.input.merchant}. Confirmar?`;
      case "update_transaction":
        return `Alterar ${label}. Confirmar?`;
      case "cancel_transaction":
        return `Cancelar ${label}? Ação irreversível.`;
      default:
        return "Confirmar operação?";
    }
  }
}
