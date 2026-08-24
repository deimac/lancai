import { jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { statusSessaoEnum } from "./enums";
import { usuario } from "./usuario";

export const sessao = pgTable("sessao", {
  id: uuid("id").primaryKey().defaultRandom(),
  usuarioId: uuid("usuario_id")
    .notNull()
    .references(() => usuario.id),
  status: statusSessaoEnum("status").notNull().default("ativa"),
  dataCriacao: timestamp("data_criacao", { withTimezone: true }).notNull().defaultNow(),
  dataAtualizacao: timestamp("data_atualizacao", { withTimezone: true }).notNull().defaultNow(),
  /** ConversationState v1 + campos ConversationContext (JSONB aditivo; schemaVersion 1 no banco). */
  contexto: jsonb("contexto").$type<Record<string, unknown>>(),
});

export type Sessao = typeof sessao.$inferSelect;
export type NovaSessao = typeof sessao.$inferInsert;
