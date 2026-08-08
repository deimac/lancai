-- F2: tabelas internas do módulo open-finance (ADR-011). Nenhum outro módulo as
-- lê: guardam a conexão com a instituição, o mapa de conta externa para conta
-- local e o webhook bruto que garante a idempotência da ingestão (ADR-015).
--
-- Escrita à mão, e não gerada: o `drizzle-kit generate` diffa contra o snapshot
-- 0000 porque as migrações 0001 a 0008 também foram manuais e não deixaram
-- snapshot. O snapshot 0009 que acompanha esta migração retrata o schema
-- completo, então daqui para frente a geração automática volta a funcionar.

CREATE TYPE "status_conexao" AS ENUM ('ativa', 'sincronizando', 'precisa_atencao', 'removida');--> statement-breakpoint
CREATE TYPE "motivo_atencao" AS ENUM ('credencial_invalida', 'consentimento_revogado', 'aguardando_usuario', 'erro_no_provedor');--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "open_finance_conexao" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "criado_por" uuid NOT NULL,
  "provedor" text NOT NULL,
  "id_externo" text NOT NULL,
  "instituicao" text,
  "status" "status_conexao" DEFAULT 'ativa' NOT NULL,
  "motivo_atencao" "motivo_atencao",
  "consentimento_expira_em" timestamp with time zone,
  "ultimo_sync_em" timestamp with time zone,
  "configuracoes" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "data_criacao" timestamp with time zone DEFAULT now() NOT NULL,
  "data_atualizacao" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "open_finance_conexao_unica" UNIQUE("provedor","id_externo")
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "open_finance_conta_externa" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "conexao_id" uuid NOT NULL,
  "id_externo" text NOT NULL,
  "nome" text NOT NULL,
  "tipo" text NOT NULL,
  "conta_id" uuid,
  "cartao_id" uuid,
  "data_criacao" timestamp with time zone DEFAULT now() NOT NULL,
  "data_atualizacao" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "open_finance_conta_externa_unica" UNIQUE("conexao_id","id_externo")
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "open_finance_evento" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provedor" text NOT NULL,
  "evento_id" text NOT NULL,
  "tipo" text NOT NULL,
  "payload" jsonb NOT NULL,
  "processado_em" timestamp with time zone,
  "erro" text,
  "data_criacao" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "open_finance_evento_unico" UNIQUE("provedor","evento_id")
);--> statement-breakpoint

ALTER TABLE "open_finance_conexao" ADD CONSTRAINT "open_finance_conexao_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_finance_conexao" ADD CONSTRAINT "open_finance_conexao_criado_por_usuario_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_finance_conta_externa" ADD CONSTRAINT "open_finance_conta_externa_conexao_id_open_finance_conexao_id_fk" FOREIGN KEY ("conexao_id") REFERENCES "public"."open_finance_conexao"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_finance_conta_externa" ADD CONSTRAINT "open_finance_conta_externa_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "open_finance_conta_externa" ADD CONSTRAINT "open_finance_conta_externa_cartao_id_cartao_id_fk" FOREIGN KEY ("cartao_id") REFERENCES "public"."cartao"("id") ON DELETE no action ON UPDATE no action;
