-- Builder de regras: nome, lógica E/OU, condições e ações em JSONB.
-- Backfill preserva regras v1 (descricao_contem → categoria).

CREATE TYPE "logica_condicoes_regra" AS ENUM('e', 'ou');--> statement-breakpoint

ALTER TABLE "regra" ADD COLUMN IF NOT EXISTS "nome" text;--> statement-breakpoint
ALTER TABLE "regra" ADD COLUMN IF NOT EXISTS "logica_condicoes" "logica_condicoes_regra" DEFAULT 'ou' NOT NULL;--> statement-breakpoint
ALTER TABLE "regra" ADD COLUMN IF NOT EXISTS "condicoes" jsonb;--> statement-breakpoint
ALTER TABLE "regra" ADD COLUMN IF NOT EXISTS "acoes" jsonb;--> statement-breakpoint

UPDATE "regra" AS r
SET
  "nome" = CONCAT('"', r."condicao_valor", '" → ', COALESCE(c."nome", 'categoria')),
  "logica_condicoes" = 'ou',
  "condicoes" = jsonb_build_array(
    jsonb_build_object(
      'campo', 'descricao',
      'operador', 'contem',
      'valor', r."condicao_valor"
    )
  ),
  "acoes" = CASE
    WHEN r."perfil" IS NOT NULL THEN
      jsonb_build_array(
        jsonb_build_object('tipo', 'definir_categoria', 'categoriaId', r."categoria_id"::text),
        jsonb_build_object('tipo', 'definir_perfil', 'perfil', r."perfil"::text)
      )
    ELSE
      jsonb_build_array(
        jsonb_build_object('tipo', 'definir_categoria', 'categoriaId', r."categoria_id"::text)
      )
  END
FROM "categoria" AS c
WHERE r."categoria_id" = c."id" AND r."condicoes" IS NULL;--> statement-breakpoint

-- Regras órfãs (categoria ausente): backfill sem join.
UPDATE "regra" SET
  "nome" = CONCAT('"', "condicao_valor", '" → categoria'),
  "logica_condicoes" = 'ou',
  "condicoes" = jsonb_build_array(
    jsonb_build_object(
      'campo', 'descricao',
      'operador', 'contem',
      'valor', "condicao_valor"
    )
  ),
  "acoes" = jsonb_build_array(
    jsonb_build_object('tipo', 'definir_categoria', 'categoriaId', "categoria_id"::text)
  )
WHERE "condicoes" IS NULL;--> statement-breakpoint

ALTER TABLE "regra" ALTER COLUMN "nome" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "regra" ALTER COLUMN "condicoes" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "regra" ALTER COLUMN "acoes" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "regra" ALTER COLUMN "condicao_tipo" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "regra" ALTER COLUMN "condicao_valor" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "regra" ALTER COLUMN "categoria_id" DROP NOT NULL;
