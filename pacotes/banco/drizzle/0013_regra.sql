-- Motor de regras do Conhecimento (F3). Um operador tipado basta para o
-- critério de pronto: "IFOOD classifica sem chamar modelo". JSONB fica para
-- quando existir DSL de verdade — um operador não justifica.

CREATE TYPE "origem_regra" AS ENUM('manual', 'aprendizado_conversa');--> statement-breakpoint
CREATE TYPE "tipo_condicao_regra" AS ENUM('descricao_contem');--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "regra" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspace"("id"),
  "origem" "origem_regra" DEFAULT 'manual' NOT NULL,
  "ativa" boolean DEFAULT true NOT NULL,
  "condicao_tipo" "tipo_condicao_regra" NOT NULL,
  "condicao_valor" text NOT NULL,
  "categoria_id" uuid NOT NULL REFERENCES "categoria"("id"),
  "perfil" "perfil",
  "data_criacao" timestamp with time zone DEFAULT now() NOT NULL,
  "data_atualizacao" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "regra_workspace_ativa_idx"
  ON "regra" ("workspace_id")
  WHERE "ativa" = true;
