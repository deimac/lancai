import { sql } from "drizzle-orm";
import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tipoCategoriaEnum } from "./enums";
import { usuario } from "./usuario";

export const categoria = pgTable(
  "categoria",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nome: text("nome").notNull(),
    tipo: tipoCategoriaEnum("tipo").notNull(),
    ativo: boolean("ativo").notNull().default(true),
    usuarioId: uuid("usuario_id")
      .notNull()
      .references(() => usuario.id),
    dataCriacao: timestamp("data_criacao", { withTimezone: true }).notNull().defaultNow(),
    dataAtualizacao: timestamp("data_atualizacao", { withTimezone: true }).notNull().defaultNow(),
  },
  (tabela) => [
    uniqueIndex("categoria_usuario_nome_ativo_unico")
      .on(tabela.usuarioId, sql`lower(${tabela.nome})`)
      .where(sql`${tabela.ativo} = true`),
  ],
);

export type Categoria = typeof categoria.$inferSelect;
export type NovaCategoria = typeof categoria.$inferInsert;
