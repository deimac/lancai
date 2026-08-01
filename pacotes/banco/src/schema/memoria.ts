import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { usuario } from "./usuario";

/** Conhecimento permanente e hábitos aprendidos do usuário. Pertence ao sistema, nunca à IA. */
export const memoria = pgTable("memoria", {
  id: uuid("id").primaryKey().defaultRandom(),
  chave: text("chave").notNull(),
  valor: text("valor").notNull(),
  usuarioId: uuid("usuario_id")
    .notNull()
    .references(() => usuario.id),
  dataCriacao: timestamp("data_criacao", { withTimezone: true }).notNull().defaultNow(),
  dataAtualizacao: timestamp("data_atualizacao", { withTimezone: true }).notNull().defaultNow(),
});

export type Memoria = typeof memoria.$inferSelect;
export type NovaMemoria = typeof memoria.$inferInsert;
