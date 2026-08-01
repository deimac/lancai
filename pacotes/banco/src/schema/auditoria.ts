import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { acaoAuditoriaEnum } from "./enums";
import { usuario } from "./usuario";

/** Registro permanente e imutável de alterações do sistema. Nunca é apagado ou alterado. */
export const auditoria = pgTable("auditoria", {
  id: uuid("id").primaryKey().defaultRandom(),
  tabela: text("tabela").notNull(),
  registroId: uuid("registro_id").notNull(),
  acao: acaoAuditoriaEnum("acao").notNull(),
  estadoAnterior: jsonb("estado_anterior"),
  estadoAtual: jsonb("estado_atual"),
  alteradoPor: uuid("alterado_por")
    .notNull()
    .references(() => usuario.id),
  dataCriacao: timestamp("data_criacao", { withTimezone: true }).notNull().defaultNow(),
});

export type Auditoria = typeof auditoria.$inferSelect;
export type NovaAuditoria = typeof auditoria.$inferInsert;
