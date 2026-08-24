import type { ConversationState } from "@lancai/tipos";

export type CanalSessao = "web" | "whatsapp";

/** JSONB cru de `sessao.contexto` (v1 + chaves v3). */
export type SessionDocumento = Record<string, unknown>;

export interface SessionRecord {
  id: string;
  usuarioId: string;
  contexto: ConversationState;
  updatedAt: Date;
}

export interface SessionDocumentoRecord {
  id: string;
  usuarioId: string;
  documento: SessionDocumento;
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
  getDocumento(sessionId: string): Promise<SessionDocumentoRecord | null>;
  getDocumentoByUsuarioAtiva(usuarioId: string): Promise<SessionDocumentoRecord | null>;
  createDocumento(usuarioId: string, documento: SessionDocumento): Promise<SessionDocumentoRecord>;
  compareAndSwapDocumento(
    sessionId: string,
    expectedVersion: number,
    documento: SessionDocumento,
  ): Promise<boolean>;
  findMessageId(messageId: string): Promise<boolean>;
  upsertMessageId(messageId: string, sessionId: string): Promise<void>;
  deleteMessageIdsOlderThan(cutoff: Date): Promise<number>;
}
