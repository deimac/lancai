-- Papel no Conhecimento: a saída na conta que quita a fatura não é gasto novo.
-- O Fato (tipo/valor/conta) permanece; relatórios filtram via ignorado_em_relatorio.

CREATE TYPE "papel_conhecimento" AS ENUM('gasto', 'pagamento_fatura');--> statement-breakpoint
ALTER TABLE "movimento" ADD COLUMN "papel" "papel_conhecimento" DEFAULT 'gasto' NOT NULL;--> statement-breakpoint
ALTER TABLE "movimento" ADD COLUMN "cartao_fatura_id" uuid;--> statement-breakpoint
ALTER TABLE "movimento" ADD COLUMN "competencia_fatura" text;--> statement-breakpoint
ALTER TABLE "movimento" ADD CONSTRAINT "movimento_cartao_fatura_id_cartao_id_fk" FOREIGN KEY ("cartao_fatura_id") REFERENCES "public"."cartao"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimento" ADD CONSTRAINT "movimento_competencia_fatura_formato" CHECK ("competencia_fatura" IS NULL OR "competencia_fatura" ~ '^\d{4}-\d{2}$');--> statement-breakpoint

-- Categoria sistema nos workspaces que ainda não a têm (garantir_categorias_padrao cobre o resto).
INSERT INTO "categoria" ("id", "workspace_id", "usuario_id", "nome", "tipo", "ativo")
SELECT gen_random_uuid(), w."id", m."usuario_id", 'Pagamento de fatura', 'ambos', true
FROM "workspace" w
JOIN LATERAL (
  SELECT "usuario_id"
  FROM "workspace_membro"
  WHERE "workspace_id" = w."id"
  ORDER BY CASE "papel" WHEN 'dono' THEN 0 ELSE 1 END, "data_criacao"
  LIMIT 1
) m ON true
WHERE NOT EXISTS (
  SELECT 1
  FROM "categoria" c
  WHERE c."workspace_id" = w."id"
    AND lower(c."nome") = lower('Pagamento de fatura')
);
