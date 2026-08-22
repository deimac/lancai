-- Recorrência detectada no histórico (Open Finance que só chega na fatura
-- fechada) vs cadastro explícito. Desativar uma detectada é o opt-out.

CREATE TYPE "origem_recorrencia" AS ENUM('cadastro', 'detectada');--> statement-breakpoint
ALTER TABLE "recorrencia" ADD COLUMN "origem" "origem_recorrencia" DEFAULT 'cadastro' NOT NULL;
