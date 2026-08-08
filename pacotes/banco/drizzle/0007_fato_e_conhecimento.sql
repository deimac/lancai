-- F1: separação entre Fato Financeiro e Conhecimento do LançAI (ADR-009),
-- fonte financeira como origem única de movimento (ADR-010) e workspace_id
-- em todas as tabelas de dados (ADR-013).
--
-- O trigger que impõe a imutabilidade do Fato vem na migração 0008.

CREATE TYPE "tipo_fonte" AS ENUM ('open_finance', 'manual', 'whatsapp', 'api', 'recorrencia', 'ofx', 'csv', 'pdf');--> statement-breakpoint
CREATE TYPE "status_fonte" AS ENUM ('confirmado', 'pendente');--> statement-breakpoint
CREATE TYPE "classificado_por" AS ENUM ('regra', 'ia', 'usuario');--> statement-breakpoint
CREATE TYPE "tipo_workspace" AS ENUM ('pessoal', 'empresa');--> statement-breakpoint
CREATE TYPE "papel_workspace" AS ENUM ('dono', 'editor', 'leitor');--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "workspace" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "nome" text NOT NULL,
  "tipo" "tipo_workspace" NOT NULL,
  "data_criacao" timestamp with time zone DEFAULT now() NOT NULL,
  "data_atualizacao" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "workspace_membro" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "usuario_id" uuid NOT NULL,
  "papel" "papel_workspace" NOT NULL,
  "data_criacao" timestamp with time zone DEFAULT now() NOT NULL,
  "data_atualizacao" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_membro_unico" UNIQUE("workspace_id","usuario_id")
);--> statement-breakpoint

ALTER TABLE "workspace_membro" ADD CONSTRAINT "workspace_membro_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_membro" ADD CONSTRAINT "workspace_membro_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Um workspace pessoal por usuário já existente. Até a F6 é assim que o
-- workspace nasce; depois disso ele passa a ser criado explicitamente.
INSERT INTO "workspace" ("nome", "tipo")
SELECT 'Pessoal', 'pessoal' FROM "usuario";--> statement-breakpoint

INSERT INTO "workspace_membro" ("workspace_id", "usuario_id", "papel")
SELECT w."id", u."id", 'dono'
FROM (SELECT "id", row_number() OVER (ORDER BY "data_criacao", "id") AS n FROM "usuario") u
JOIN (SELECT "id", row_number() OVER (ORDER BY "data_criacao", "id") AS n FROM "workspace") w
  ON w.n = u.n;--> statement-breakpoint

-- workspace_id em todas as tabelas de dados: adiciona anulável, preenche a
-- partir do dono, depois exige. `parcela` fica de fora porque herda o escopo
-- do movimento ao qual pertence.
ALTER TABLE "conta" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "cartao" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "categoria" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "pessoa" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "movimento" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "orcamento" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "recorrencia" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "memoria" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint

UPDATE "conta" t SET "workspace_id" = m."workspace_id" FROM "workspace_membro" m WHERE m."usuario_id" = t."usuario_id" AND m."papel" = 'dono';--> statement-breakpoint
UPDATE "cartao" t SET "workspace_id" = m."workspace_id" FROM "workspace_membro" m WHERE m."usuario_id" = t."usuario_id" AND m."papel" = 'dono';--> statement-breakpoint
UPDATE "categoria" t SET "workspace_id" = m."workspace_id" FROM "workspace_membro" m WHERE m."usuario_id" = t."usuario_id" AND m."papel" = 'dono';--> statement-breakpoint
UPDATE "pessoa" t SET "workspace_id" = m."workspace_id" FROM "workspace_membro" m WHERE m."usuario_id" = t."usuario_id" AND m."papel" = 'dono';--> statement-breakpoint
UPDATE "movimento" t SET "workspace_id" = m."workspace_id" FROM "workspace_membro" m WHERE m."usuario_id" = t."usuario_id" AND m."papel" = 'dono';--> statement-breakpoint
UPDATE "orcamento" t SET "workspace_id" = m."workspace_id" FROM "workspace_membro" m WHERE m."usuario_id" = t."usuario_id" AND m."papel" = 'dono';--> statement-breakpoint
UPDATE "recorrencia" t SET "workspace_id" = m."workspace_id" FROM "workspace_membro" m WHERE m."usuario_id" = t."usuario_id" AND m."papel" = 'dono';--> statement-breakpoint
UPDATE "memoria" t SET "workspace_id" = m."workspace_id" FROM "workspace_membro" m WHERE m."usuario_id" = t."usuario_id" AND m."papel" = 'dono';--> statement-breakpoint

ALTER TABLE "conta" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cartao" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "categoria" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pessoa" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "movimento" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orcamento" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recorrencia" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "memoria" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "conta" ADD CONSTRAINT "conta_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cartao" ADD CONSTRAINT "cartao_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categoria" ADD CONSTRAINT "categoria_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pessoa" ADD CONSTRAINT "pessoa_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimento" ADD CONSTRAINT "movimento_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orcamento" ADD CONSTRAINT "orcamento_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recorrencia" ADD CONSTRAINT "recorrencia_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memoria" ADD CONSTRAINT "memoria_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Contas e cartões alimentados por Open Finance (ADR-012).
ALTER TABLE "conta" ADD COLUMN "sincronizada" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cartao" ADD COLUMN "sincronizada" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- movimento: grupo FATO FINANCEIRO.
-- Os movimentos já existentes nasceram de conversa ou de cadastro manual, e o
-- registro atual não distingue os dois; todos ficam como 'manual'.
ALTER TABLE "movimento" ADD COLUMN "fonte" "tipo_fonte" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "movimento" ADD COLUMN "provedor" text;--> statement-breakpoint
ALTER TABLE "movimento" ADD COLUMN "id_externo" text;--> statement-breakpoint
ALTER TABLE "movimento" ADD COLUMN "favorecido_fonte" text;--> statement-breakpoint
ALTER TABLE "movimento" ADD COLUMN "status_fonte" "status_fonte" DEFAULT 'confirmado' NOT NULL;--> statement-breakpoint
ALTER TABLE "movimento" ADD COLUMN "descricao_fonte" text;--> statement-breakpoint
UPDATE "movimento" SET "descricao_fonte" = "descricao" WHERE "descricao_fonte" IS NULL;--> statement-breakpoint
ALTER TABLE "movimento" ALTER COLUMN "descricao_fonte" SET NOT NULL;--> statement-breakpoint

-- movimento: grupo CONHECIMENTO DO LANÇAI.
ALTER TABLE "movimento" ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "movimento" ADD COLUMN "observacoes" text;--> statement-breakpoint
ALTER TABLE "movimento" ADD COLUMN "classificado_por" "classificado_por" DEFAULT 'usuario' NOT NULL;--> statement-breakpoint
ALTER TABLE "movimento" ADD COLUMN "confianca_ia" numeric(4, 3);--> statement-breakpoint
ALTER TABLE "movimento" ADD COLUMN "ignorado_em_relatorio" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- Deduplicação de ingestão. Parcial porque lançamento manual não tem
-- id_externo e pode repetir legitimamente.
CREATE UNIQUE INDEX IF NOT EXISTS "movimento_id_externo_unico" ON "movimento" ("workspace_id","fonte","provedor","id_externo") WHERE "id_externo" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "movimento_workspace_data_idx" ON "movimento" ("workspace_id","data_movimento");
