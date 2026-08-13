import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { usuario } from "./usuario";

/**
 * Identidade estável da conta/cartão do usuário. Permanece quando o itemId
 * do provedor muda (reatachar). Conta e cartão locais apontam para cá.
 *
 * `conexao_id` é denormalização da conexão Open Finance atual — sem FK no
 * Drizzle para não criar ciclo com `open_finance_conexao`.
 */
export const contaFinanceira = pgTable("conta_financeira", {
  id: uuid("id").primaryKey().defaultRandom(),
  usuarioId: uuid("usuario_id")
    .notNull()
    .references(() => usuario.id),
  instituicao: text("instituicao").notNull(),
  nomeExibicao: text("nome_exibicao").notNull(),
  mascara: text("mascara"),
  tipo: text("tipo").notNull(),
  perfil: text("perfil").notNull().$type<"pf" | "pj">(),
  bancoCodigo: text("banco_codigo"),
  agencia: text("agencia"),
  contaNumero: text("conta_numero"),
  conexaoStatus: text("conexao_status").$type<
    "conectado" | "desatualizado" | "precisa_atencao" | "desconectado"
  >(),
  conexaoId: uuid("conexao_id"),
  ultimoSyncEm: timestamp("ultimo_sync_em", { withTimezone: true }),
  origem: text("origem").notNull().$type<"manual" | "open_finance">(),
  dataCriacao: timestamp("data_criacao", { withTimezone: true }).notNull().defaultNow(),
  dataAtualizacao: timestamp("data_atualizacao", { withTimezone: true }).notNull().defaultNow(),
});

export type ContaFinanceira = typeof contaFinanceira.$inferSelect;
export type NovaContaFinanceira = typeof contaFinanceira.$inferInsert;
