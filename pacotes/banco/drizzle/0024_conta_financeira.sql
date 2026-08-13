-- Identidade financeira estável da conta/cartão. Idempotente: um script
-- ad-hoc pode já ter criado a tabela (created_at/updated_at) neste ambiente.

CREATE TABLE IF NOT EXISTS "conta_financeira" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "usuario_id" uuid NOT NULL REFERENCES "usuario"("id"),
    "instituicao" text NOT NULL,
    "nome_exibicao" text NOT NULL,
    "mascara" text,
    "tipo" text NOT NULL,
    "perfil" text NOT NULL,
    "banco_codigo" text,
    "agencia" text,
    "conta_numero" text,
    "conexao_status" text,
    "conexao_id" uuid REFERENCES "open_finance_conexao"("id"),
    "ultimo_sync_em" timestamptz,
    "origem" text NOT NULL,
    "data_criacao" timestamptz NOT NULL DEFAULT now(),
    "data_atualizacao" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'conta_financeira' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE "conta_financeira" RENAME COLUMN "created_at" TO "data_criacao";
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'conta_financeira' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE "conta_financeira" RENAME COLUMN "updated_at" TO "data_atualizacao";
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "conta_financeira" ALTER COLUMN "data_criacao" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "conta_financeira" ALTER COLUMN "data_criacao" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "conta_financeira" ALTER COLUMN "data_atualizacao" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "conta_financeira" ALTER COLUMN "data_atualizacao" SET NOT NULL;--> statement-breakpoint

DROP TRIGGER IF EXISTS conta_financeira_updated_at ON "conta_financeira";--> statement-breakpoint

ALTER TABLE "conta_financeira" DROP CONSTRAINT IF EXISTS conta_financeira_usuario_id_instituicao_mascara_tipo_key;--> statement-breakpoint
DROP INDEX IF EXISTS conta_financeira_usuario_id_instituicao_mascara_tipo_key;--> statement-breakpoint

ALTER TABLE "conta" ADD COLUMN IF NOT EXISTS "conta_financeira_id" uuid REFERENCES "conta_financeira"("id");--> statement-breakpoint
ALTER TABLE "cartao" ADD COLUMN IF NOT EXISTS "conta_financeira_id" uuid REFERENCES "conta_financeira"("id");--> statement-breakpoint
ALTER TABLE "open_finance_conta_externa" ADD COLUMN IF NOT EXISTS "conta_financeira_id" uuid REFERENCES "conta_financeira"("id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS conta_financeira_usuario_id_idx ON "conta_financeira" ("usuario_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS conta_financeira_conexao_id_idx ON "conta_financeira" ("conexao_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS conta_conta_financeira_id_idx ON "conta" ("conta_financeira_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cartao_conta_financeira_id_idx ON "cartao" ("conta_financeira_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS open_finance_conta_externa_conta_financeira_id_idx ON "open_finance_conta_externa" ("conta_financeira_id");--> statement-breakpoint

-- 1:1 para contas/cartões ainda sem identidade (ambientes novos ou leftovers).
DO $$
DECLARE
  r RECORD;
  novo_id uuid;
BEGIN
  FOR r IN SELECT id, usuario_id, nome, perfil, sincronizada FROM conta WHERE conta_financeira_id IS NULL
  LOOP
    INSERT INTO conta_financeira (usuario_id, instituicao, nome_exibicao, tipo, perfil, origem, conexao_status)
    VALUES (
      r.usuario_id,
      CASE WHEN r.sincronizada THEN 'Open Finance' ELSE 'Manual' END,
      r.nome,
      'conta_corrente',
      r.perfil,
      CASE WHEN r.sincronizada THEN 'open_finance' ELSE 'manual' END,
      CASE WHEN r.sincronizada THEN 'conectado' ELSE 'desconectado' END
    )
    RETURNING id INTO novo_id;
    UPDATE conta SET conta_financeira_id = novo_id WHERE id = r.id;
  END LOOP;

  FOR r IN SELECT id, usuario_id, nome, perfil, sincronizada FROM cartao WHERE conta_financeira_id IS NULL
  LOOP
    INSERT INTO conta_financeira (usuario_id, instituicao, nome_exibicao, tipo, perfil, origem, conexao_status)
    VALUES (
      r.usuario_id,
      CASE WHEN r.sincronizada THEN 'Open Finance' ELSE 'Manual' END,
      r.nome,
      'credito',
      r.perfil,
      CASE WHEN r.sincronizada THEN 'open_finance' ELSE 'manual' END,
      CASE WHEN r.sincronizada THEN 'conectado' ELSE 'desconectado' END
    )
    RETURNING id INTO novo_id;
    UPDATE cartao SET conta_financeira_id = novo_id WHERE id = r.id;
  END LOOP;
END $$;
