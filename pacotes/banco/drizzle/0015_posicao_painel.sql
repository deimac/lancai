-- Preferência do painel do assistente no cockpit (pós-F4): deixa de viver só
-- no localStorage e passa a acompanhar o usuário entre dispositivos.

CREATE TYPE "posicao_painel" AS ENUM('lateral', 'inferior');--> statement-breakpoint

ALTER TABLE "usuario" ADD COLUMN IF NOT EXISTS "posicao_painel" "posicao_painel"
  DEFAULT 'lateral' NOT NULL;
