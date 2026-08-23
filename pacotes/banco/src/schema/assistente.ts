import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sessao } from "./sessao";

/**
 * Deduplicação de messageId do WhatsApp (TTL 24h via limpeza no SessionManager).
 */
export const sessaoMessageId = pgTable(
  "sessao_message_id",
  {
    messageId: text("message_id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessao.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (tabela) => [index("sessao_message_id_created_at_idx").on(tabela.createdAt)],
);

export type SessaoMessageId = typeof sessaoMessageId.$inferSelect;
export type NovaSessaoMessageId = typeof sessaoMessageId.$inferInsert;

/**
 * Idempotência de comando financeiro do Assistente 2.0 (TTL 24h).
 */
export const assistenteIdempotency = pgTable(
  "assistente_idempotency",
  {
    key: uuid("key").primaryKey(),
    resultado: jsonb("resultado").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (tabela) => [index("assistente_idempotency_created_at_idx").on(tabela.createdAt)],
);

export type AssistenteIdempotency = typeof assistenteIdempotency.$inferSelect;
export type NovaAssistenteIdempotency = typeof assistenteIdempotency.$inferInsert;
