import { boolean, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { perfilEnum } from "./enums";
import { conta } from "./conta";
import { usuario } from "./usuario";

export const cartao = pgTable("cartao", {
  id: uuid("id").primaryKey().defaultRandom(),
  nome: text("nome").notNull(),
  /** Armazenado como string decimal (numeric do Postgres) para evitar perda de precisão. */
  limite: numeric("limite", { precision: 14, scale: 2 }).notNull(),
  fechamento: integer("fechamento").notNull(),
  vencimento: integer("vencimento").notNull(),
  /** Calculado dinamicamente pelo MotorFinanceiro: dia seguinte ao fechamento. */
  melhorDiaCompra: integer("melhor_dia_compra").notNull(),
  perfil: perfilEnum("perfil").notNull(),
  ativo: boolean("ativo").notNull().default(true),
  contaId: uuid("conta_id")
    .notNull()
    .references(() => conta.id),
  usuarioId: uuid("usuario_id")
    .notNull()
    .references(() => usuario.id),
  dataCriacao: timestamp("data_criacao", { withTimezone: true }).notNull().defaultNow(),
  dataAtualizacao: timestamp("data_atualizacao", { withTimezone: true }).notNull().defaultNow(),
});

export type Cartao = typeof cartao.$inferSelect;
export type NovoCartao = typeof cartao.$inferInsert;
