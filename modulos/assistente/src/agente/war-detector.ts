export type WrongActionType =
  | "missing_confirmation"
  | "unauthorized_write"
  | "wrong_entity";

export type TurnTrace = {
  op?: string;
  executed?: boolean;
  confirmRequired?: boolean;
  confirmed?: boolean;
  targetFonte?: string;
  fatoImutavel?: boolean;
  requestedTargetId?: string;
  executedEntityId?: string;
};

const WRITES = new Set(["create", "update", "delete"]);

/**
 * Detector simples de Wrong Action no trace do turno.
 * Não bloqueia a resposta — só classifica o que executou.
 */
export function detectWrongAction(trace: TurnTrace): WrongActionType | null {
  if (!trace.executed) return null;

  if (trace.op && WRITES.has(trace.op) && trace.confirmRequired && !trace.confirmed) {
    return "missing_confirmation";
  }

  if (
    (trace.op === "update" || trace.op === "delete") &&
    (trace.fatoImutavel === true || trace.targetFonte === "open_finance")
  ) {
    return "unauthorized_write";
  }

  if (
    trace.requestedTargetId &&
    trace.executedEntityId &&
    trace.requestedTargetId !== trace.executedEntityId &&
    trace.requestedTargetId !== "00000000-0000-4000-8000-000000000000"
  ) {
    return "wrong_entity";
  }

  return null;
}
