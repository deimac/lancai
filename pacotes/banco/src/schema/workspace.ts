import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { papelWorkspaceEnum } from "./enums";
import { usuario } from "./usuario";

/**
 * Agrupador para filtros e relatórios (movimentos). Contas e cartões são
 * globais do usuário — não se listam filtrando por workspace. Ver ADR-013.
 */
export const workspace = pgTable("workspace", {
  id: uuid("id").primaryKey().defaultRandom(),
  nome: text("nome").notNull(),
  /** Texto livre opcional — workspace é só organizador de contas. */
  descricao: text("descricao"),
  /** Cor da UI (swatch: violet, blue, teal, …). */
  cor: text("cor").notNull().default("violet"),
  dataCriacao: timestamp("data_criacao", { withTimezone: true }).notNull().defaultNow(),
  dataAtualizacao: timestamp("data_atualizacao", { withTimezone: true }).notNull().defaultNow(),
});

export const workspaceMembro = pgTable(
  "workspace_membro",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id),
    usuarioId: uuid("usuario_id")
      .notNull()
      .references(() => usuario.id),
    papel: papelWorkspaceEnum("papel").notNull(),
    dataCriacao: timestamp("data_criacao", { withTimezone: true }).notNull().defaultNow(),
    dataAtualizacao: timestamp("data_atualizacao", { withTimezone: true }).notNull().defaultNow(),
  },
  (tabela) => [unique("workspace_membro_unico").on(tabela.workspaceId, tabela.usuarioId)],
);

export type Workspace = typeof workspace.$inferSelect;
export type NovoWorkspace = typeof workspace.$inferInsert;
export type WorkspaceMembro = typeof workspaceMembro.$inferSelect;
export type NovoWorkspaceMembro = typeof workspaceMembro.$inferInsert;
