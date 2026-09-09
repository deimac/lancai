ALTER TABLE "bill_allocation"
ALTER COLUMN "competencia"
DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "bill_allocation"
DROP CONSTRAINT IF EXISTS "bill_allocation_competencia_formato";
--> statement-breakpoint
ALTER TABLE "bill_allocation"
DROP CONSTRAINT IF EXISTS "bill_allocation_competencia_status_check";
--> statement-breakpoint
ALTER TABLE "bill_allocation"
ADD CONSTRAINT "bill_allocation_competencia_formato" CHECK (
    "competencia" IS NULL
    OR "competencia" ~ '^\d{4}-\d{2}$'
);
--> statement-breakpoint
ALTER TABLE "bill_allocation"
ADD CONSTRAINT "bill_allocation_competencia_status_check" CHECK (
    (
        "status" = 'nao_resolvido'
        AND "competencia" IS NULL
    )
    OR (
        "status" <> 'nao_resolvido'
        AND "competencia" IS NOT NULL
    )
);