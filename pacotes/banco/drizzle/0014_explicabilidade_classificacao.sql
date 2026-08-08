-- Explicabilidade do Conhecimento: a UI precisa dizer "classifiquei pela regra
-- IFOOD" ou "você ensinou em 03/08". Sem apontar a regra e a data, só dá para
-- mostrar o rótulo genérico regra/IA/você.

ALTER TABLE "movimento" ADD COLUMN IF NOT EXISTS "regra_id" uuid
  REFERENCES "regra"("id") ON DELETE SET NULL;--> statement-breakpoint

ALTER TABLE "movimento" ADD COLUMN IF NOT EXISTS "classificado_em" timestamp with time zone;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "movimento_regra_id_idx" ON "movimento" ("regra_id");
