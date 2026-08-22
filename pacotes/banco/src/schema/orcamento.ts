import { boolean, date, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { origemRecorrenciaEnum, tipoMovimentoEnum } from "./enums";
import { categoria } from "./categoria";
import { conta } from "./conta";
import { cartao } from "./cartao";
import { usuario } from "./usuario";
import { workspace } from "./workspace";

/**
 * Limite de gasto mensal (geral ou por categoria).
 * `categoria_id` null = teto mensal geral.
 * `recorrente_mensal` true = aplica a todo mês; `mes_referencia` (YYYY-MM-01) para orçamento pontual.
 */
export const orcamento = pgTable("orcamento", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id),
  usuarioId: uuid("usuario_id")
    .notNull()
    .references(() => usuario.id),
  categoriaId: uuid("categoria_id").references(() => categoria.id),
  valorLimite: numeric("valor_limite", { precision: 14, scale: 2 }).notNull(),
  /** Primeiro dia do mês (YYYY-MM-01) quando não recorrente; null se recorrente_mensal. */
  mesReferencia: date("mes_referencia"),
  recorrenteMensal: boolean("recorrente_mensal").notNull().default(true),
  ativo: boolean("ativo").notNull().default(true),
  dataCriacao: timestamp("data_criacao", { withTimezone: true }).notNull().defaultNow(),
  dataAtualizacao: timestamp("data_atualizacao", { withTimezone: true }).notNull().defaultNow(),
});

export type Orcamento = typeof orcamento.$inferSelect;
export type NovoOrcamento = typeof orcamento.$inferInsert;

/**
 * Assinatura/despesa recorrente mensal (≠ parcela de cartão).
 * Cron diário gera movimento no `dia_do_mes`.
 */
export const recorrencia = pgTable("recorrencia", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id),
  usuarioId: uuid("usuario_id")
    .notNull()
    .references(() => usuario.id),
  descricao: text("descricao").notNull(),
  valor: numeric("valor", { precision: 14, scale: 2 }).notNull(),
  tipo: tipoMovimentoEnum("tipo").notNull().default("despesa"),
  categoriaId: uuid("categoria_id")
    .notNull()
    .references(() => categoria.id),
  contaId: uuid("conta_id").references(() => conta.id),
  cartaoId: uuid("cartao_id").references(() => cartao.id),
  diaDoMes: integer("dia_do_mes").notNull(),
  ativa: boolean("ativa").notNull().default(true),
  /**
   * `detectada` veio do padrão do extrato. Desativar (`ativa = false`) é o
   * opt-out: o cron não rematerializa nem gera o mês.
   */
  origem: origemRecorrenciaEnum("origem").notNull().default("cadastro"),
  /** Último mês gerado (YYYY-MM) — idempotência. */
  ultimaGeracao: text("ultima_geracao"),
  dataCriacao: timestamp("data_criacao", { withTimezone: true }).notNull().defaultNow(),
  dataAtualizacao: timestamp("data_atualizacao", { withTimezone: true }).notNull().defaultNow(),
});

export type Recorrencia = typeof recorrencia.$inferSelect;
export type NovaRecorrencia = typeof recorrencia.$inferInsert;
