import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Eventos brutos recebidos do webhook da Evolution API (sem processamento de IA). */
export const evolutionEvento = pgTable("evolution_evento", {
  id: uuid("id").primaryKey().defaultRandom(),
  evento: text("evento").notNull(),
  instancia: text("instancia").notNull(),
  /** Payload completo do webhook, sem o campo apikey. */
  payload: jsonb("payload").notNull(),
  dataEvento: timestamp("data_evento", { withTimezone: true }),
  dataCriacao: timestamp("data_criacao", { withTimezone: true }).notNull().defaultNow(),
});

export type EvolutionEvento = typeof evolutionEvento.$inferSelect;
export type NovoEvolutionEvento = typeof evolutionEvento.$inferInsert;
