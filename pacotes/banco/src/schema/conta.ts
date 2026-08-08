import { boolean, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { perfilEnum } from "./enums";
import { usuario } from "./usuario";
import { workspace } from "./workspace";

export const conta = pgTable("conta", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id),
  nome: text("nome").notNull(),
  /** Armazenado como string decimal (numeric do Postgres) para evitar perda de precisão. */
  saldoInicial: numeric("saldo_inicial", { precision: 14, scale: 2 }).notNull().default("0"),
  saldoAtual: numeric("saldo_atual", { precision: 14, scale: 2 }).notNull().default("0"),
  perfil: perfilEnum("perfil").notNull(),
  ativo: boolean("ativo").notNull().default(true),
  /**
   * Conta alimentada por Open Finance. Quando true, o Fato dos movimentos
   * vindos da sincronização é imutável e a IA só pode enriquecer (ADR-012).
   */
  sincronizada: boolean("sincronizada").notNull().default(false),
  usuarioId: uuid("usuario_id")
    .notNull()
    .references(() => usuario.id),
  dataCriacao: timestamp("data_criacao", { withTimezone: true }).notNull().defaultNow(),
  dataAtualizacao: timestamp("data_atualizacao", { withTimezone: true }).notNull().defaultNow(),
});

export type Conta = typeof conta.$inferSelect;
export type NovaConta = typeof conta.$inferInsert;
