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
  /**
   * Workspace real usado em writes (chat/OF/cadastros). Null = primeiro do usuário (ou cria Principal).
   * FK em `0017_workspace_ativo.sql` (evita import circular com `workspace`).
   */
  workspaceAtivoId: uuid("workspace_ativo_id"),
  /**
   * Quando true, leituras do cockpit agregam todos os workspaces do dono (visão "Geral").
   * Writes continuam no workspace_ativo_id real.
   */
  visaoAgregada: boolean("visao_agregada").notNull().default(true),
  ativo: boolean("ativo").notNull().default(true),
  dataCriacao: timestamp("data_criacao", { withTimezone: true }).notNull().defaultNow(),
  dataAtualizacao: timestamp("data_atualizacao", { withTimezone: true }).notNull().defaultNow(),
});

export type Usuario = typeof usuario.$inferSelect;
export type NovoUsuario = typeof usuario.$inferInsert;
