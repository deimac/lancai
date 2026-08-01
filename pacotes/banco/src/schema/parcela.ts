import { date, integer, numeric, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { statusMovimentoEnum } from "./enums";
import { movimento } from "./movimento";

/** Desdobramento físico e projeção de um movimento parcelado. */
export const parcela = pgTable("parcela", {
  id: uuid("id").primaryKey().defaultRandom(),
  movimentoId: uuid("movimento_id")
    .notNull()
    .references(() => movimento.id),
  numeroParcela: integer("numero_parcela").notNull(),
  /** Armazenado como string decimal (numeric do Postgres) para evitar perda de precisão. */
  valor: numeric("valor", { precision: 14, scale: 2 }).notNull(),
  dataMovimento: date("data_movimento").notNull(),
  status: statusMovimentoEnum("status").notNull().default("previsto"),
  dataCriacao: timestamp("data_criacao", { withTimezone: true }).notNull().defaultNow(),
  dataAtualizacao: timestamp("data_atualizacao", { withTimezone: true }).notNull().defaultNow(),
});

export type Parcela = typeof parcela.$inferSelect;
export type NovaParcela = typeof parcela.$inferInsert;
