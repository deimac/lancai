import {
  CreateRecurrenceInputSchema,
  CreateRuleInputSchema,
  CreateTransactionInputSchema,
  type CommandResult,
  type SimpleCommand,
} from "@lancai/tipos";
import { err, ok, type Result } from "../resultado";

export type CommandHandlerErro = string;

function validateCreateTransaction(input: Record<string, unknown>): Result<SimpleCommand> {
  const parsed = CreateTransactionInputSchema.safeParse(input);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Dados inválidos");
  const d = parsed.data;
  const tipo = d.tipo ?? "despesa";
  if (tipo === "transferencia") {
    if (!d.contaId || !d.contaDestinoId) return err("Transferência exige contaId e contaDestinoId");
    if (d.contaId === d.contaDestinoId) return err("Conta origem e destino devem ser diferentes");
  } else if (d.formaPagamento === "credito") {
    if (!d.cartaoId) return err("Cartão obrigatório para crédito");
    if (d.contaId) return err("Conta não permitida para crédito");
  } else if (d.formaPagamento === "debito") {
    if (!d.contaId && !d.cartaoId) return err("Conta ou cartão obrigatório para débito");
  } else if (!d.contaId && !d.cartaoId) {
    return err("Conta obrigatória");
  }
  return ok({ type: "create_transaction", input: { ...d, tipo } });
}

export function montarCreateTransaction(params: Record<string, unknown>): Result<SimpleCommand> {
  return validateCreateTransaction(params);
}

export function montarUpdateTransaction(input: {
  movementId: string;
  params: Record<string, unknown>;
}): Result<SimpleCommand> {
  const fatoKeys = ["valor", "dataMovimento", "contaId", "cartaoId", "tipo", "descricaoFonte", "formaPagamento", "parcelamento"] as const;
  const conheKeys = ["categoriaId", "pessoaId", "perfil", "tags", "observacoes", "ignoradoEmRelatorio"] as const;
  const fatoPatch: Record<string, unknown> = {};
  const conhecimentoPatch: Record<string, unknown> = {};
  for (const k of fatoKeys) if (input.params[k] !== undefined) fatoPatch[k] = input.params[k];
  for (const k of conheKeys) if (input.params[k] !== undefined) conhecimentoPatch[k] = input.params[k];
  if (Object.keys(fatoPatch).length === 0 && Object.keys(conhecimentoPatch).length === 0) {
    return err("Nenhum campo para alterar");
  }
  return ok({
    type: "update_transaction",
    input: {
      movementId: input.movementId,
      fatoPatch: Object.keys(fatoPatch).length ? fatoPatch : undefined,
      conhecimentoPatch: Object.keys(conhecimentoPatch).length ? conhecimentoPatch : undefined,
    },
  });
}

export function montarCancelTransaction(movementId: string): Result<SimpleCommand> {
  if (!movementId) return err("movementId obrigatório");
  return ok({ type: "cancel_transaction", input: { movementId } });
}

export function montarQueryTransactions(params: Record<string, unknown>): Result<SimpleCommand> {
  return ok({ type: "query_transactions", spec: params });
}

export function montarCreateRecurrence(params: Record<string, unknown>): Result<SimpleCommand> {
  const parsed = CreateRecurrenceInputSchema.safeParse(params);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Recorrência inválida");
  if (!parsed.data.contaId && !parsed.data.cartaoId) return err("Recorrência exige conta ou cartão");
  return ok({ type: "create_recurrence", input: parsed.data });
}

export function montarCreateRule(params: Record<string, unknown>): Result<SimpleCommand> {
  const parsed = CreateRuleInputSchema.safeParse(params);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "Regra inválida");
  return ok({ type: "create_rule", input: parsed.data });
}

export function resultadoErro(error: string): CommandResult {
  return { success: false, error };
}
