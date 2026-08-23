import { randomUUID } from "node:crypto";
import {
  estadoInicialConversacao,
  normalizarConversationState,
  type ConversationState,
} from "@lancai/tipos";
import type { SessionRecord, SessionRepository } from "./tipos-sessao";

interface MessageIdRecord {
  messageId: string;
  sessionId: string;
  createdAt: Date;
}

/**
 * Repositório em memória para testes do SessionManager (CAS, lock, dedup).
 */
export class SessionRepositoryMemory implements SessionRepository {
  private readonly sessoes = new Map<string, SessionRecord>();
  private readonly messageIds = new Map<string, MessageIdRecord>();
  /** Falhas forçadas de CAS (para teste de backoff). */
  falhasCasRestantes = 0;

  async get(sessionId: string): Promise<SessionRecord | null> {
    const registro = this.sessoes.get(sessionId);
    if (!registro) return null;
    return {
      ...registro,
      contexto: structuredClone(registro.contexto),
    };
  }

  async getByUsuarioAtiva(usuarioId: string): Promise<SessionRecord | null> {
    const ativas = [...this.sessoes.values()]
      .filter((s) => s.usuarioId === usuarioId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const primeira = ativas[0];
    return primeira ? this.get(primeira.id) : null;
  }

  async create(usuarioId: string, contexto?: ConversationState): Promise<SessionRecord> {
    const agora = new Date();
    const registro: SessionRecord = {
      id: randomUUID(),
      usuarioId,
      contexto: contexto ? structuredClone(contexto) : estadoInicialConversacao(),
      updatedAt: agora,
    };
    this.sessoes.set(registro.id, registro);
    return this.get(registro.id) as Promise<SessionRecord>;
  }

  async compareAndSwap(
    sessionId: string,
    expectedVersion: number,
    newState: ConversationState,
  ): Promise<boolean> {
    if (this.falhasCasRestantes > 0) {
      this.falhasCasRestantes -= 1;
      return false;
    }
    const registro = this.sessoes.get(sessionId);
    if (!registro) return false;
    if (registro.contexto.version !== expectedVersion) return false;
    registro.contexto = normalizarConversationState(structuredClone(newState));
    registro.updatedAt = new Date();
    return true;
  }

  async findMessageId(messageId: string): Promise<boolean> {
    return this.messageIds.has(messageId);
  }

  async upsertMessageId(messageId: string, sessionId: string): Promise<void> {
    this.messageIds.set(messageId, { messageId, sessionId, createdAt: new Date() });
  }

  async deleteMessageIdsOlderThan(cutoff: Date): Promise<number> {
    let removidos = 0;
    for (const [id, rec] of this.messageIds) {
      if (rec.createdAt < cutoff) {
        this.messageIds.delete(id);
        removidos += 1;
      }
    }
    return removidos;
  }
}
