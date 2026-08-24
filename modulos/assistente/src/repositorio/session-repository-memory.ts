import { randomUUID } from "node:crypto";
import {
  estadoInicialConversacao,
  normalizarConversationState,
  type ConversationState,
} from "@lancai/tipos";
import type {
  SessionDocumento,
  SessionDocumentoRecord,
  SessionRecord,
  SessionRepository,
} from "./tipos-sessao";

interface MessageIdRecord {
  messageId: string;
  sessionId: string;
  createdAt: Date;
}

interface SessaoInterna {
  id: string;
  usuarioId: string;
  documento: SessionDocumento;
  updatedAt: Date;
}

function versaoDe(documento: SessionDocumento): number {
  return typeof documento.version === "number" && Number.isFinite(documento.version)
    ? documento.version
    : 0;
}

function registroV1(interna: SessaoInterna): SessionRecord {
  return {
    id: interna.id,
    usuarioId: interna.usuarioId,
    contexto: normalizarConversationState(structuredClone(interna.documento)),
    updatedAt: interna.updatedAt,
  };
}

function registroDocumento(interna: SessaoInterna): SessionDocumentoRecord {
  return {
    id: interna.id,
    usuarioId: interna.usuarioId,
    documento: structuredClone(interna.documento),
    updatedAt: interna.updatedAt,
  };
}

/**
 * Repositório em memória para testes do SessionManager (CAS, lock, dedup).
 * `get`/`compareAndSwap` continuam no ConversationState v1 (Zod strip).
 * `getDocumento`/`compareAndSwapDocumento` preservam chaves v3.
 */
export class SessionRepositoryMemory implements SessionRepository {
  private readonly sessoes = new Map<string, SessaoInterna>();
  private readonly messageIds = new Map<string, MessageIdRecord>();
  /** Falhas forçadas de CAS (para teste de backoff). */
  falhasCasRestantes = 0;

  async get(sessionId: string): Promise<SessionRecord | null> {
    const interna = this.sessoes.get(sessionId);
    return interna ? registroV1(interna) : null;
  }

  async getByUsuarioAtiva(usuarioId: string): Promise<SessionRecord | null> {
    const doc = await this.getDocumentoByUsuarioAtiva(usuarioId);
    if (!doc) return null;
    const interna = this.sessoes.get(doc.id);
    return interna ? registroV1(interna) : null;
  }

  async create(usuarioId: string, contexto?: ConversationState): Promise<SessionRecord> {
    const doc = await this.createDocumento(
      usuarioId,
      (contexto ?? estadoInicialConversacao()) as unknown as SessionDocumento,
    );
    const interna = this.sessoes.get(doc.id)!;
    return registroV1(interna);
  }

  async compareAndSwap(
    sessionId: string,
    expectedVersion: number,
    newState: ConversationState,
  ): Promise<boolean> {
    return this.compareAndSwapDocumento(
      sessionId,
      expectedVersion,
      normalizarConversationState(structuredClone(newState)) as unknown as SessionDocumento,
    );
  }

  async getDocumento(sessionId: string): Promise<SessionDocumentoRecord | null> {
    const interna = this.sessoes.get(sessionId);
    return interna ? registroDocumento(interna) : null;
  }

  async getDocumentoByUsuarioAtiva(usuarioId: string): Promise<SessionDocumentoRecord | null> {
    const ativas = [...this.sessoes.values()]
      .filter((s) => s.usuarioId === usuarioId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const primeira = ativas[0];
    return primeira ? registroDocumento(primeira) : null;
  }

  async createDocumento(usuarioId: string, documento: SessionDocumento): Promise<SessionDocumentoRecord> {
    const agora = new Date();
    const interna: SessaoInterna = {
      id: randomUUID(),
      usuarioId,
      documento: structuredClone(documento),
      updatedAt: agora,
    };
    this.sessoes.set(interna.id, interna);
    return registroDocumento(interna);
  }

  async compareAndSwapDocumento(
    sessionId: string,
    expectedVersion: number,
    documento: SessionDocumento,
  ): Promise<boolean> {
    if (this.falhasCasRestantes > 0) {
      this.falhasCasRestantes -= 1;
      return false;
    }
    const registro = this.sessoes.get(sessionId);
    if (!registro) return false;
    if (versaoDe(registro.documento) !== expectedVersion) return false;
    registro.documento = structuredClone(documento);
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
