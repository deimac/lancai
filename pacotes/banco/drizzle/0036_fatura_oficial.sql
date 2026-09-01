-- Total oficial da fatura fechada (Open Finance Bill). Aberto continua na soma das linhas.

CREATE TABLE IF NOT EXISTS "fatura_oficial" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspace"("id"),
  "cartao_id" uuid NOT NULL REFERENCES "cartao"("id"),
  "id_externo" text NOT NULL,
  "competencia" text NOT NULL,
  "total" numeric(14, 2) NOT NULL,
  "data_fechamento" date,
  "data_vencimento" date,
  "data_criacao" timestamp with time zone DEFAULT now() NOT NULL,
  "data_atualizacao" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fatura_oficial_competencia_formato" CHECK ("competencia" ~ '^\d{4}-\d{2}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fatura_oficial_id_externo" ON "fatura_oficial" ("cartao_id", "id_externo");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fatura_oficial_competencia" ON "fatura_oficial" ("cartao_id", "competencia");
--> statement-breakpoint
ALTER TABLE "fatura_oficial" ENABLE ROW LEVEL SECURITY;
