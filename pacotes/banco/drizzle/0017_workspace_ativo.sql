ALTER TABLE "usuario" ADD COLUMN "workspace_ativo_id" uuid;
--> statement-breakpoint
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_workspace_ativo_id_workspace_id_fk" FOREIGN KEY ("workspace_ativo_id") REFERENCES "public"."workspace"("id") ON DELETE set null ON UPDATE no action;
