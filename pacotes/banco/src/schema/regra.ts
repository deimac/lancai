import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { origemRegraEnum, perfilEnum, tipoCondicaoRegraEnum } from "./enums";
import { categoria } from "./categoria";
import { workspace } from "./workspace";

/**
 * Regra de classificação do Conhecimento. A v1 tem um operador só —
 * `descricao_contem` — porque isso basta para o critério da F3: "IFOOD
 * classifica sem chamar modelo". Condição e ação são colunas tipadas, não
 * JSONB: um operador não justifica DSL.
 *
 * Casa contra `descricao`, `descricao_fonte` e `favorecido_fonte`. O texto do
 * banco é o que importa na ingestão; a descrição do usuário importa depois.
 */
export const regra = pgTable("regra", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id),
  origem: origemRegraEnum("origem").notNull().default("manual"),
  ativa: boolean("ativa").notNull().default(true),

  condicaoTipo: tipoCondicaoRegraEnum("condicao_tipo").notNull(),
  /** O trecho procurado — "IFOOD", "UBER", etc. Comparação sem distinção de maiúscula. */
  condicaoValor: text("condicao_valor").notNull(),

  categoriaId: uuid("categoria_id")
    .notNull()
    .references(() => categoria.id),
  /** Opcional: além da categoria, fixa o perfil. */
  perfil: perfilEnum("perfil"),

  dataCriacao: timestamp("data_criacao", { withTimezone: true }).notNull().defaultNow(),
  dataAtualizacao: timestamp("data_atualizacao", { withTimezone: true }).notNull().defaultNow(),
});

export type Regra = typeof regra.$inferSelect;
export type NovaRegra = typeof regra.$inferInsert;
