import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { papelWorkspaceEnum, tipoWorkspaceEnum } from "./enums";
import { usuario } from "./usuario";

/**
 * Contexto financeiro isolado (um CPF, um CNPJ, uma família).
 * Existe desde a F1 apenas como escopo de dados: até a F6 cada usuário
 * tem exatamente um workspace, criado automaticamente. Ver ADR-013.
 */
export const workspace = pgTable("workspace", {
  id: uuid("id").primaryKey().defaultRandom(),
  nome: text("nome").notNull(),
  /** Texto livre opcional — workspace é só organizador de contas. */
  descricao: text("descricao"),
  /**
   * Legado interno (enum pessoal|empresa). Não é produto: PF/PJ vive em conta/cartão.
   * Novos inserts usam "pessoal" por default de compatibilidade.
   */
  tipo: tipoWorkspaceEnum("tipo").notNull(),
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
