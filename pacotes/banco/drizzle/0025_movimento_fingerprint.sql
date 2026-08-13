-- Fingerprint determinístico para reidentificar Fato OF quando idExterno muda.
-- NÃO é único: duas compras iguais no mesmo dia compartilham o hash.

ALTER TABLE "movimento" ADD COLUMN IF NOT EXISTS "fingerprint" text;--> statement-breakpoint

-- O script ad-hoc criou um UNIQUE que recusa o segundo café idêntico. Cai fora.
DROP INDEX IF EXISTS movimento_fingerprint_open_finance_unico;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS movimento_fingerprint_idx
  ON "movimento" ("fingerprint")
  WHERE "fingerprint" IS NOT NULL;
