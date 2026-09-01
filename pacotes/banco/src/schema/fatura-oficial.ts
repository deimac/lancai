import { numeric, pgTable, text, timestamp, unique, uuid, date } from "drizzle-orm/pg-core";
import { cartao } from "./cartao";
import { workspace } from "./workspace";

/**
 * Fatura fechada que o provedor publicou (`totalAmount`).
 * Fatura aberta em geral não vem — o Cockpit continua na soma das linhas.
 */
export const faturaOficial = pgTable(
  "fatura_oficial",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id),
    cartaoId: uuid("cartao_id")
      .notNull()
      .references(() => cartao.id),
    idExterno: text("id_externo").notNull(),
    competencia: text("competencia").notNull(),
    total: numeric("total", { precision: 14, scale: 2 }).notNull(),
    dataFechamento: date("data_fechamento"),
    dataVencimento: date("data_vencimento"),
    dataCriacao: timestamp("data_criacao", { withTimezone: true }).notNull().defaultNow(),
    dataAtualizacao: timestamp("data_atualizacao", { withTimezone: true }).notNull().defaultNow(),
  },
  (tabela) => [
    unique("fatura_oficial_id_externo").on(tabela.cartaoId, tabela.idExterno),
    unique("fatura_oficial_competencia").on(tabela.cartaoId, tabela.competencia),
  ],
);

export type FaturaOficial = typeof faturaOficial.$inferSelect;
export type NovaFaturaOficial = typeof faturaOficial.$inferInsert;
