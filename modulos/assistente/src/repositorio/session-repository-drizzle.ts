import { and, eq, lt, sql } from "drizzle-orm";
import {
  assistenteIdempotency,
  obter_banco,
  sessao as sessaoTabela,
  sessaoMessageId,
} from "@lancai/banco";
import {
  estadoInicialConversacao,
  normalizarConversationState,
  type CommandResult,
  type ConversationState,
} from "@lancai/tipos";
import type {
  SessionDocumento,
  SessionDocumentoRecord,
  SessionRecord,
  SessionRepository,
} from "./tipos-sessao";

function registro_de_linha(linha: {
  id: string;
  usuarioId: string;
  contexto: Record<string, unknown> | null;
  dataAtualizacao: Date;
}): SessionRecord {
  return {
    id: linha.id,
    usuarioId: linha.usuarioId,
    contexto: normalizarConversationState(linha.contexto ?? estadoInicialConversacao()),
    updatedAt: linha.dataAtualizacao,
  };
}

function registro_de_documento(linha: {
  id: string;
  usuarioId: string;
  contexto: Record<string, unknown> | null;
  dataAtualizacao: Date;
}): SessionDocumentoRecord {
  const bruto =
    linha.contexto && typeof linha.contexto === "object" && !Array.isArray(linha.contexto)
      ? linha.contexto
      : {};
  return {
    id: linha.id,
    usuarioId: linha.usuarioId,
    documento: structuredClone(bruto),
    updatedAt: linha.dataAtualizacao,
  };
}

/**
 * Persistência Drizzle de sessão, ConversationState e messageId WhatsApp.
 */
export class SessionRepositoryDrizzle implements SessionRepository {
  async get(sessionId: string): Promise<SessionRecord | null> {
    const banco = obter_banco();
    const [linha] = await banco
      .select()
      .from(sessaoTabela)
      .where(eq(sessaoTabela.id, sessionId))
      .limit(1);
    return linha ? registro_de_linha(linha) : null;
  }

  async getByUsuarioAtiva(usuarioId: string): Promise<SessionRecord | null> {
    const banco = obter_banco();
    const [linha] = await banco
      .select()
      .from(sessaoTabela)
      .where(and(eq(sessaoTabela.usuarioId, usuarioId), eq(sessaoTabela.status, "ativa")))
      .orderBy(sql`${sessaoTabela.dataAtualizacao} desc`)
      .limit(1);
    return linha ? registro_de_linha(linha) : null;
  }

  async getDocumento(sessionId: string): Promise<SessionDocumentoRecord | null> {
    const banco = obter_banco();
    const [linha] = await banco
      .select()
      .from(sessaoTabela)
      .where(eq(sessaoTabela.id, sessionId))
      .limit(1);
    return linha ? registro_de_documento(linha) : null;
  }

  async getDocumentoByUsuarioAtiva(usuarioId: string): Promise<SessionDocumentoRecord | null> {
    const banco = obter_banco();
    const [linha] = await banco
      .select()
      .from(sessaoTabela)
      .where(and(eq(sessaoTabela.usuarioId, usuarioId), eq(sessaoTabela.status, "ativa")))
      .orderBy(sql`${sessaoTabela.dataAtualizacao} desc`)
      .limit(1);
    return linha ? registro_de_documento(linha) : null;
  }

  async create(usuarioId: string, contexto?: ConversationState): Promise<SessionRecord> {
    const banco = obter_banco();
    const estado = contexto ?? estadoInicialConversacao();
    const [linha] = await banco
      .insert(sessaoTabela)
      .values({
        usuarioId,
        contexto: estado as unknown as Record<string, unknown>,
      })
      .returning();
    if (!linha) throw new Error("Falha ao criar sessão.");
    return registro_de_linha(linha);
  }

  async compareAndSwap(
    sessionId: string,
    expectedVersion: number,
    newState: ConversationState,
  ): Promise<boolean> {
    const banco = obter_banco();
    const estado = normalizarConversationState(newState);
    return banco.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${sessionId}, 0))`);
      const atualizados = await tx
        .update(sessaoTabela)
        .set({
          contexto: estado as unknown as Record<string, unknown>,
          dataAtualizacao: new Date(),
        })
        .where(
          and(
            eq(sessaoTabela.id, sessionId),
            sql`coalesce((${sessaoTabela.contexto}->>'version')::int, 0) = ${expectedVersion}`,
          ),
        )
        .returning({ id: sessaoTabela.id });
      return atualizados.length > 0;
    });
  }

  async createDocumento(usuarioId: string, documento: SessionDocumento): Promise<SessionDocumentoRecord> {
    const banco = obter_banco();
    const [linha] = await banco
      .insert(sessaoTabela)
      .values({
        usuarioId,
        contexto: structuredClone(documento),
      })
      .returning();
    if (!linha) throw new Error("Falha ao criar sessão.");
    return registro_de_documento(linha);
  }

  async compareAndSwapDocumento(
    sessionId: string,
    expectedVersion: number,
    documento: SessionDocumento,
  ): Promise<boolean> {
    const banco = obter_banco();
    return banco.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${sessionId}, 0))`);
      const atualizados = await tx
        .update(sessaoTabela)
        .set({
          contexto: structuredClone(documento),
          dataAtualizacao: new Date(),
        })
        .where(
          and(
            eq(sessaoTabela.id, sessionId),
            sql`coalesce((${sessaoTabela.contexto}->>'version')::int, 0) = ${expectedVersion}`,
          ),
        )
        .returning({ id: sessaoTabela.id });
      return atualizados.length > 0;
    });
  }

  async findMessageId(messageId: string): Promise<boolean> {
    const banco = obter_banco();
    const [linha] = await banco
      .select({ messageId: sessaoMessageId.messageId })
      .from(sessaoMessageId)
      .where(eq(sessaoMessageId.messageId, messageId))
      .limit(1);
    return Boolean(linha);
  }

  async upsertMessageId(messageId: string, sessionId: string): Promise<void> {
    const banco = obter_banco();
    await banco
      .insert(sessaoMessageId)
      .values({ messageId, sessionId })
      .onConflictDoNothing({ target: sessaoMessageId.messageId });
  }

  async deleteMessageIdsOlderThan(cutoff: Date): Promise<number> {
    const banco = obter_banco();
    const removidos = await banco
      .delete(sessaoMessageId)
      .where(lt(sessaoMessageId.createdAt, cutoff))
      .returning({ messageId: sessaoMessageId.messageId });
    return removidos.length;
  }
}

/**
 * Idempotência de comando no Postgres (mesma migration 0032).
 */
export class PostgresIdempotencyStore {
  async get(key: string): Promise<CommandResult | null> {
    const banco = obter_banco();
    const [linha] = await banco
      .select()
      .from(assistenteIdempotency)
      .where(eq(assistenteIdempotency.key, key))
      .limit(1);
    if (!linha) return null;
    return linha.resultado as CommandResult;
  }

  async set(key: string, value: CommandResult): Promise<void> {
    const banco = obter_banco();
    await banco
      .insert(assistenteIdempotency)
      .values({ key, resultado: value })
      .onConflictDoNothing({ target: assistenteIdempotency.key });
  }
}
