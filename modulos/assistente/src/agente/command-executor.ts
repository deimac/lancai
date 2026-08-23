import type { CommandContext, CommandResult, SimpleCommand, UserRequest } from "@lancai/tipos";
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
}
