import type {
  CommandContext,
  CommandResult,
  ExecutionPlan,
  SimpleCommand,
  UserRequest,
} from "@lancai/tipos";
import { err, type Result } from "../resultado";
import {
  montarCancelTransaction,
  montarCreateRecurrence,
  montarCreateRule,
  montarCreateTransaction,
  montarQueryTransactions,
  montarUpdateTransaction,
} from "../comandos/handlers";
import type { ApplicationService } from "../application/application-service";

/**
 * Traduz UserRequest em SimpleCommand e delega ao ApplicationService.
 */
export class CommandExecutor {
  constructor(private readonly application: ApplicationService) {}

  montarComando(request: UserRequest, movementId?: string): Result<SimpleCommand> {
    const chave = `${request.op}_${request.resource}`;
    switch (chave) {
      case "create_transaction":
        return montarCreateTransaction(request.params);
      case "update_transaction":
      case "classify_transaction":
        if (!movementId) return err("Alvo não resolvido");
        return montarUpdateTransaction({ movementId, params: request.params });
      case "delete_transaction":
        if (!movementId) return err("Alvo não resolvido");
        return montarCancelTransaction(movementId);
      case "query_transaction":
        return montarQueryTransactions(request.params);
      case "create_recurrence":
        return montarCreateRecurrence(request.params);
      case "create_rule":
        return montarCreateRule(request.params);
      default:
        return err(`Handler não encontrado: ${chave}`);
    }
  }

  async execute(
    request: UserRequest,
    context: CommandContext,
    movementId?: string,
    resolvedIds?: { accountId?: string; cardId?: string; categoryId?: string },
  ): Promise<CommandResult> {
    const params = { ...request.params };
    if (resolvedIds?.accountId) params.contaId = resolvedIds.accountId;
    if (resolvedIds?.cardId) params.cartaoId = resolvedIds.cardId;
    if (resolvedIds?.categoryId) params.categoriaId = resolvedIds.categoryId;
    const comando = this.montarComando({ ...request, params }, movementId);
    if (!comando.ok) return { success: false, error: comando.error };
    return this.application.executeCommand(comando.value, context);
  }

  /**
   * Executa QueryPlan (vira query_transactions) ou os steps de um CommandPlan em ordem.
   * Não substitui `execute(UserRequest)`.
   */
  async executePlan(plan: ExecutionPlan, context: CommandContext): Promise<CommandResult> {
    if (plan.type === "query") {
      return this.application.executeCommand({ type: "query_transactions", spec: plan.spec }, context);
    }

    if (plan.steps.length === 0) {
      return { success: false, error: "Plano vazio" };
    }

    const porId = new Map<string, CommandResult>();
    let ultimo: CommandResult = { success: false, error: "Plano vazio" };

    for (const step of plan.steps) {
      if (step.dependsOn?.some((id) => !porId.get(id)?.success)) {
        return { success: false, error: `Dependência falhou: ${step.dependsOn.join(", ")}` };
      }
      ultimo = await this.application.executeCommand(step.command, context);
      porId.set(step.stepId, ultimo);
      if (!ultimo.success) break;
    }

    return ultimo;
  }
}
