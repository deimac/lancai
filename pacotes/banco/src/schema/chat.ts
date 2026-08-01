import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { papelChatEnum } from "./enums";
import { sessao } from "./sessao";

export const chat = pgTable("chat", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessaoId: uuid("sessao_id")
    .notNull()
    .references(() => sessao.id),
  papel: papelChatEnum("papel").notNull(),
  conteudo: text("conteudo").notNull(),
  /** JSON gerado pelo InterpretadorIntencoes, quando o papel for 'ia'. */
  intencaoDetectada: jsonb("intencao_detectada"),
  dataCriacao: timestamp("data_criacao", { withTimezone: true }).notNull().defaultNow(),
});

export type Chat = typeof chat.$inferSelect;
export type NovoChat = typeof chat.$inferInsert;
