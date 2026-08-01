import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tipoPessoaEnum } from "./enums";
import { usuario } from "./usuario";

export const pessoa = pgTable("pessoa", {
  id: uuid("id").primaryKey().defaultRandom(),
  nome: text("nome").notNull(),
  tipo: tipoPessoaEnum("tipo").notNull(),
  ativo: boolean("ativo").notNull().default(true),
  usuarioId: uuid("usuario_id")
    .notNull()
    .references(() => usuario.id),
  dataCriacao: timestamp("data_criacao", { withTimezone: true }).notNull().defaultNow(),
  dataAtualizacao: timestamp("data_atualizacao", { withTimezone: true }).notNull().defaultNow(),
});

export type Pessoa = typeof pessoa.$inferSelect;
export type NovaPessoa = typeof pessoa.$inferInsert;
