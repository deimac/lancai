import type {
  CommandResult,
  ConversationState,
  ExecutionPlan,
  ResolvedRequest,
  SimpleCommand,
} from "@lancai/tipos";

/**
 * Texto curto para o usuário a partir do resultado do comando.
 */
export class ResponseGenerator {
  generate(result: CommandResult, _state: ConversationState, request: ResolvedRequest): string {
    if (!result.success) return result.error ? `Não consegui: ${result.error}` : "Não consegui concluir.";

    switch (request.request.op) {
      case "create":
        return this.formatCreate(result.data, request.request.resource);
      case "update":
        return `Pronto. ${request.resolved.target?.label ?? "Lançamento"} atualizado.`;
      case "delete":
        return "Cancelado.";
      case "query": {
        const data = result.data as { formattedText?: string } | undefined;
        return data?.formattedText ?? "Aqui está o que encontrei.";
      }
      case "classify":
        return "Classificado.";
      default:
        return "Operação realizada.";
    }
  }

  private formatCreate(data: unknown, resource: string): string {
    const d = (data ?? {}) as Record<string, unknown>;
    if (resource === "transaction") {
      return `Lançado: ${String(d.descricao ?? "lançamento")}.`;
    }
    if (resource === "recurrence") {
      return `Recorrência criada: ${String(d.descricao ?? "")} todo dia ${String(d.diaDoMes ?? "")}.`;
    }
    if (resource === "rule") {
      return `Regra criada: ${String(d.nome ?? d.merchant ?? "")}.`;
    }
    return "Criado com sucesso.";
  }

  /** Texto a partir de ExecutionPlan (Core V3). `generate` do v2 permanece intacto. */
  generateFromPlan(result: CommandResult, plan: ExecutionPlan): string {
    if (!result.success) return result.error ? `Não consegui: ${result.error}` : "Não consegui concluir.";

    if (plan.type === "query") {
      const data = result.data as { formattedText?: string } | undefined;
      return data?.formattedText ?? "Aqui está o que encontrei.";
    }

    const comando = plan.steps[plan.steps.length - 1]?.command;
    if (!comando) return "Operação realizada.";
    return this.textoDeComando(result, comando);
  }

  private textoDeComando(result: CommandResult, comando: SimpleCommand): string {
    const d = (result.data ?? {}) as Record<string, unknown>;
    switch (comando.type) {
      case "create_transaction":
        return `Lançado: ${String(d.descricao ?? comando.input.descricao ?? "lançamento")}.`;
      case "create_recurrence":
        return `Recorrência criada: ${String(d.descricao ?? comando.input.descricao ?? "")} todo dia ${String(d.diaDoMes ?? comando.input.diaDoMes ?? "")}.`;
      case "create_rule":
        return `Regra criada: ${String(d.nome ?? d.merchant ?? comando.input.merchant ?? "")}.`;
      case "update_transaction":
        return "Pronto. Lançamento atualizado.";
      case "cancel_transaction":
        return "Cancelado.";
      case "query_transactions": {
        const data = result.data as { formattedText?: string } | undefined;
        return data?.formattedText ?? "Aqui está o que encontrei.";
      }
      default:
        return "Operação realizada.";
    }
  }
}
