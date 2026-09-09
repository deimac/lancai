-- Evidências de fatura do provedor (BillAllocation) — ver
-- docs/AUDITORIA_TECNICA_CARTAOES_FATURAS_V2.md. Aditivo: não altera a leitura
-- atual de faturas fechadas (fatura_oficial / aplicar_total_oficial).

ALTER TABLE "movimento"
ADD COLUMN IF NOT EXISTS "provider_bill_id" text;
--> statement-breakpoint
ALTER TABLE "movimento"
ADD COLUMN IF NOT EXISTS "provider_bill_forecast_date" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "movimento_provider_bill_id_idx" ON "movimento" ("provider_bill_id")
WHERE
    "provider_bill_id" IS NOT NULL;
--> statement-breakpoint

CREATE TYPE "status_alocacao_fatura" AS ENUM('confirmado', 'previsto', 'possivel', 'nao_resolvido');
--> statement-breakpoint
CREATE TYPE "metodo_alocacao_fatura" AS ENUM(
  'provider_bill_id',
  'provider_forecast',
  'regra_ciclo',
  'historico',
  'correspondencia',
  'manual',
  'nao_resolvido'
);
--> statement-breakpoint
CREATE TYPE "estado_conflito_alocacao" AS ENUM('nenhum', 'conflito', 'resolvido');
--> statement-breakpoint
CREATE TYPE "origem_auditoria_alocacao" AS ENUM('sistema', 'provedor', 'usuario');
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "bill_allocation" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid () NOT NULL,
    "workspace_id" uuid NOT NULL REFERENCES "workspace" ("id"),
    "movimento_id" uuid NOT NULL REFERENCES "movimento" ("id"),
    "cartao_id" uuid NOT NULL REFERENCES "cartao" ("id"),
    "competencia" text,
    "fatura_oficial_id" uuid REFERENCES "fatura_oficial" ("id"),
    "status" "status_alocacao_fatura" NOT NULL,
    "metodo" "metodo_alocacao_fatura" NOT NULL,
    "confidence_score" integer,
    "valor_alocado" numeric(14, 2),
    "valido_desde" timestamp
    with
        time zone DEFAULT now() NOT NULL,
        "valido_ate" timestamp
    with
        time zone,
        "is_current" boolean DEFAULT true NOT NULL,
        "estado_conflito" "estado_conflito_alocacao" DEFAULT 'nenhum' NOT NULL,
        "conflito_motivo" text,
        "conflito_dados_origem" jsonb,
        "resolvido_por" uuid REFERENCES "usuario" ("id"),
        "resolvido_em" timestamp
    with
        time zone,
        "data_criacao" timestamp
    with
        time zone DEFAULT now() NOT NULL,
        "data_atualizacao" timestamp
    with
        time zone DEFAULT now() NOT NULL,
        CONSTRAINT "bill_allocation_competencia_formato" CHECK (
            "competencia" IS NULL
            OR "competencia" ~ '^\d{4}-\d{2}$'
        ),
        CONSTRAINT "bill_allocation_competencia_status_check" CHECK (
            (
                "status" = 'nao_resolvido'
                AND "competencia" IS NULL
            )
            OR (
                "status" <> 'nao_resolvido'
                AND "competencia" IS NOT NULL
            )
        )
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "bill_allocation_movimento_atual_unico" ON "bill_allocation" ("movimento_id")
WHERE
    "is_current" = true;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bill_allocation_cartao_competencia_idx" ON "bill_allocation" ("cartao_id", "competencia");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bill_allocation_fatura_oficial_idx" ON "bill_allocation" ("fatura_oficial_id")
WHERE
    "fatura_oficial_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "bill_allocation" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "bill_allocation_audit_log" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid () NOT NULL,
    "workspace_id" uuid NOT NULL REFERENCES "workspace" ("id"),
    "alocacao_id" uuid NOT NULL REFERENCES "bill_allocation" ("id"),
    "acao" text NOT NULL,
    "estado_anterior" jsonb,
    "estado_novo" jsonb,
    "origem" "origem_auditoria_alocacao" NOT NULL,
    "usuario_id" uuid REFERENCES "usuario" ("id"),
    "data_criacao" timestamp
    with
        time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "bill_allocation_audit_log_alocacao_idx" ON "bill_allocation_audit_log" ("alocacao_id");
--> statement-breakpoint
ALTER TABLE "bill_allocation_audit_log" ENABLE ROW LEVEL SECURITY;