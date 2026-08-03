import { date, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { formaPagamentoEnum, perfilEnum, statusMovimentoEnum, tipoMovimentoEnum } from "./enums";
import { conta } from "./conta";
import { cartao } from "./cartao";
import { categoria } from "./categoria";
import { pessoa } from "./pessoa";
import { usuario } from "./usuario";

/** Qualquer evento financeiro registrado. Nunca chamar de "transação". */
export const movimento = pgTable("movimento", {
  id: uuid("id").primaryKey().defaultRandom(),
  descricao: text("descricao").notNull(),
  /** Armazenado como string decimal (numeric do Postgres) para evitar perda de precisão. */
  valor: numeric("valor", { precision: 14, scale: 2 }).notNull(),
  tipo: tipoMovimentoEnum("tipo").notNull(),
  status: statusMovimentoEnum("status").notNull().default("realizado"),
  /** Define se o gasto/ganho em si é pessoal ('pf') ou empresarial ('pj'). */
  perfil: perfilEnum("perfil").notNull(),
  /**
   * Meio de pagamento (pix, crédito, débito…). Independente de `tipo`.
   * Pode ser null em lançamentos antigos ou quando a mensagem não deixou claro.
   */
  formaPagamento: formaPagamentoEnum("forma_pagamento"),
  dataMovimento: date("data_movimento").notNull(),
  dataLancamento: timestamp("data_lancamento", { withTimezone: true }).notNull().defaultNow(),
  contaId: uuid("conta_id").references(() => conta.id),
  cartaoId: uuid("cartao_id").references(() => cartao.id),
  categoriaId: uuid("categoria_id")
    .notNull()
    .references(() => categoria.id),
  pessoaId: uuid("pessoa_id").references(() => pessoa.id),
  usuarioId: uuid("usuario_id")
    .notNull()
    .references(() => usuario.id),
  dataCriacao: timestamp("data_criacao", { withTimezone: true }).notNull().defaultNow(),
  dataAtualizacao: timestamp("data_atualizacao", { withTimezone: true }).notNull().defaultNow(),
  criadoPor: uuid("criado_por")
    .notNull()
    .references(() => usuario.id),
  alteradoPor: uuid("alterado_por").references(() => usuario.id),
});

export type Movimento = typeof movimento.$inferSelect;
export type NovoMovimento = typeof movimento.$inferInsert;
