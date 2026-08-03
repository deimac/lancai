CREATE TYPE "public"."modalidade_cartao" AS ENUM('credito', 'debito', 'multiplo');--> statement-breakpoint
CREATE TYPE "public"."forma_pagamento" AS ENUM('pix', 'transferencia', 'boleto', 'dinheiro', 'credito', 'debito');--> statement-breakpoint
ALTER TABLE "cartao" ADD COLUMN "modalidade" "modalidade_cartao" DEFAULT 'credito' NOT NULL;--> statement-breakpoint
ALTER TABLE "movimento" ADD COLUMN "forma_pagamento" "forma_pagamento";
