import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tipoCategoriaEnum } from "./enums";
import { usuario } from "./usuario";
import { workspace } from "./workspace";

export const categoria = pgTable("categoria", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id),
  nome: text("nome").notNull(),
  tipo: tipoCategoriaEnum("tipo").notNull(),
  ativo: boolean("ativo").notNull().default(true),
  usuarioId: uuid("usuario_id")
    .notNull()
    .references(() => usuario.id),
  dataCriacao: timestamp("data_criacao", { withTimezone: true }).notNull().defaultNow(),
  dataAtualizacao: timestamp("data_atualizacao", { withTimezone: true }).notNull().defaultNow(),
});

export type Categoria = typeof categoria.$inferSelect;
export type NovaCategoria = typeof categoria.$inferInsert;
