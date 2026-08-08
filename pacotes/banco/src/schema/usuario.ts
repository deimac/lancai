import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { posicaoPainelEnum } from "./enums";

export const usuario = pgTable("usuario", {
  id: uuid("id").primaryKey().defaultRandom(),
  nome: text("nome").notNull(),
  email: text("email").notNull().unique(),
  /** Número WhatsApp só com dígitos (ex.: 5511999999999). Null até o primeiro vínculo. */
  whatsappNumero: text("whatsapp_numero").unique(),
  /** Posição do painel do assistente no cockpit — acompanha o usuário entre dispositivos. */
  posicaoPainel: posicaoPainelEnum("posicao_painel").notNull().default("lateral"),
  ativo: boolean("ativo").notNull().default(true),
  dataCriacao: timestamp("data_criacao", { withTimezone: true }).notNull().defaultNow(),
  dataAtualizacao: timestamp("data_atualizacao", { withTimezone: true }).notNull().defaultNow(),
});

export type Usuario = typeof usuario.$inferSelect;
export type NovoUsuario = typeof usuario.$inferInsert;
