import type { CommandResult, ConversationState, ResolvedRequest } from "@lancai/tipos";

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
}
