-- Dois Pix iguais no mesmo minuto: grava os dois e pergunta no Extrato se é repetido.

ALTER TABLE "movimento" ADD COLUMN IF NOT EXISTS "possivel_repetido" boolean DEFAULT false NOT NULL;
