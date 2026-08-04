ALTER TABLE "usuario" ADD COLUMN "whatsapp_numero" text;--> statement-breakpoint
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_whatsapp_numero_unique" UNIQUE("whatsapp_numero");
