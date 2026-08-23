import type { ConversationState } from "@lancai/tipos";

export type CanalSessao = "web" | "whatsapp";

export interface SessionRecord {
  id: string;
  usuarioId: string;
  contexto: ConversationState;
  updatedAt: Date;
}

export interface SessionRepository {
  get(sessionId: string): Promise<SessionRecord | null>;
  getByUsuarioAtiva(usuarioId: string): Promise<SessionRecord | null>;
  create(usuarioId: string, contexto?: ConversationState): Promise<SessionRecord>;
  compareAndSwap(
    sessionId: string,
    expectedVersion: number,
    newState: ConversationState,
  ): Promise<boolean>;
  findMessageId(messageId: string): Promise<boolean>;
  upsertMessageId(messageId: string, sessionId: string): Promise<void>;
  deleteMessageIdsOlderThan(cutoff: Date): Promise<number>;
}
