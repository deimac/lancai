import { boolean, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import {
  logicaCondicoesRegraEnum,
  origemRegraEnum,
  perfilEnum,
  tipoCondicaoRegraEnum,
} from "./enums";
import { categoria } from "./categoria";
import { workspace } from "./workspace";

/** Espelha `@lancai/tipos` — tipagem local para não acoplar o pacote banco. */
export type CondicaoRegraJson = {
  campo: string;
  operador: string;
  valor: string;
};

export type AcaoRegraJson = {
  tipo: string;
  [chave: string]: unknown;
};

/**
 * Regra de classificação do Conhecimento. Condições e ações em JSONB
 * (builder com E/OU, vários operadores e ações). Colunas legadas
 * (`condicao_*`, `categoria_id`) ficam anuláveis após o backfill.
 */
export const regra = pgTable("regra", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id),
  origem: origemRegraEnum("origem").notNull().default("manual"),
  ativa: boolean("ativa").notNull().default(true),
  nome: text("nome").notNull(),
  logicaCondicoes: logicaCondicoesRegraEnum("logica_condicoes").notNull().default("ou"),
  condicoes: jsonb("condicoes").$type<CondicaoRegraJson[]>().notNull(),
  acoes: jsonb("acoes").$type<AcaoRegraJson[]>().notNull(),

  /** Legado v1 — mantido anulável após migration 0023. */
  condicaoTipo: tipoCondicaoRegraEnum("condicao_tipo"),
  condicaoValor: text("condicao_valor"),
  categoriaId: uuid("categoria_id").references(() => categoria.id),
  perfil: perfilEnum("perfil"),

  dataCriacao: timestamp("data_criacao", { withTimezone: true }).notNull().defaultNow(),
  dataAtualizacao: timestamp("data_atualizacao", { withTimezone: true }).notNull().defaultNow(),
});

export type Regra = typeof regra.$inferSelect;
export type NovaRegra = typeof regra.$inferInsert;
