-- Categorias passam a ser globais por usuário (sem workspace_id).
-- Homônimas de workspaces diferentes viram um único id.

CREATE TABLE "_tmp_categoria_merge_0028" (
  "drop_id" uuid PRIMARY KEY,
  "keep_id" uuid NOT NULL
);--> statement-breakpoint

INSERT INTO "_tmp_categoria_merge_0028" ("drop_id", "keep_id")
WITH ranked AS (
  SELECT
    c."id",
    c."usuario_id",
    lower(c."nome") AS nome_norm,
    ROW_NUMBER() OVER (
      PARTITION BY c."usuario_id", lower(c."nome")
      ORDER BY
        (SELECT count(*) FROM "movimento" m WHERE m."categoria_id" = c."id") DESC,
        c."data_criacao" ASC,
        c."id" ASC
    ) AS rn
  FROM "categoria" c
)
SELECT r."id", k."id"
FROM ranked r
JOIN ranked k
  ON k."usuario_id" = r."usuario_id"
 AND k.nome_norm = r.nome_norm
 AND k.rn = 1
WHERE r.rn > 1;--> statement-breakpoint

UPDATE "movimento" AS m
SET "categoria_id" = t."keep_id"
FROM "_tmp_categoria_merge_0028" t
WHERE m."categoria_id" = t."drop_id";--> statement-breakpoint

UPDATE "regra" AS r
SET "categoria_id" = t."keep_id"
FROM "_tmp_categoria_merge_0028" t
WHERE r."categoria_id" = t."drop_id";--> statement-breakpoint

UPDATE "orcamento" AS o
SET "categoria_id" = t."keep_id"
FROM "_tmp_categoria_merge_0028" t
WHERE o."categoria_id" = t."drop_id";--> statement-breakpoint

UPDATE "recorrencia" AS rec
SET "categoria_id" = t."keep_id"
FROM "_tmp_categoria_merge_0028" t
WHERE rec."categoria_id" = t."drop_id";--> statement-breakpoint

UPDATE "regra" AS r
SET "acoes" = (
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN elem.value->>'tipo' = 'definir_categoria'
       AND t."keep_id" IS NOT NULL
      THEN jsonb_set(elem.value, '{categoriaId}', to_jsonb(t."keep_id"::text))
      ELSE elem.value
    END
    ORDER BY elem.ordinality
  ), '[]'::jsonb)
  FROM jsonb_array_elements(COALESCE(r."acoes", '[]'::jsonb)) WITH ORDINALITY AS elem(value, ordinality)
  LEFT JOIN "_tmp_categoria_merge_0028" t
    ON t."drop_id" = NULLIF(elem.value->>'categoriaId', '')::uuid
)
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements(COALESCE(r."acoes", '[]'::jsonb)) AS elem
  JOIN "_tmp_categoria_merge_0028" t ON t."drop_id" = NULLIF(elem->>'categoriaId', '')::uuid
);--> statement-breakpoint

UPDATE "categoria" AS c
SET "ativo" = true, "data_atualizacao" = now()
FROM "_tmp_categoria_merge_0028" t
JOIN "categoria" AS duplicata ON duplicata."id" = t."drop_id"
WHERE c."id" = t."keep_id"
  AND c."ativo" = false
  AND duplicata."ativo" = true;--> statement-breakpoint

DELETE FROM "categoria"
WHERE "id" IN (SELECT "drop_id" FROM "_tmp_categoria_merge_0028");--> statement-breakpoint

DROP TABLE "_tmp_categoria_merge_0028";--> statement-breakpoint

ALTER TABLE "categoria" DROP CONSTRAINT "categoria_workspace_id_workspace_id_fk";--> statement-breakpoint
ALTER TABLE "categoria" DROP COLUMN "workspace_id";--> statement-breakpoint

CREATE UNIQUE INDEX "categoria_usuario_nome_ativo_unico"
  ON "categoria" ("usuario_id", lower("nome"))
  WHERE "ativo" = true;
