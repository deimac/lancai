-- Orçamentos mensais (geral ou por categoria) e despesas recorrentes.
CREATE TABLE IF NOT EXISTS "orcamento" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "usuario_id" uuid NOT NULL,
  "categoria_id" uuid,
  "valor_limite" numeric(14, 2) NOT NULL,
  "mes_referencia" date,
  "recorrente_mensal" boolean DEFAULT true NOT NULL,
  "ativo" boolean DEFAULT true NOT NULL,
  "data_criacao" timestamp with time zone DEFAULT now() NOT NULL,
  "data_atualizacao" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recorrencia" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "usuario_id" uuid NOT NULL,
  "descricao" text NOT NULL,
  "valor" numeric(14, 2) NOT NULL,
  "tipo" "tipo_movimento" DEFAULT 'despesa' NOT NULL,
  "categoria_id" uuid NOT NULL,
  "conta_id" uuid,
  "cartao_id" uuid,
  "dia_do_mes" integer NOT NULL,
  "ativa" boolean DEFAULT true NOT NULL,
  "ultima_geracao" text,
  "data_criacao" timestamp with time zone DEFAULT now() NOT NULL,
  "data_atualizacao" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "orcamento" ADD CONSTRAINT "orcamento_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orcamento" ADD CONSTRAINT "orcamento_categoria_id_categoria_id_fk" FOREIGN KEY ("categoria_id") REFERENCES "public"."categoria"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recorrencia" ADD CONSTRAINT "recorrencia_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recorrencia" ADD CONSTRAINT "recorrencia_categoria_id_categoria_id_fk" FOREIGN KEY ("categoria_id") REFERENCES "public"."categoria"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recorrencia" ADD CONSTRAINT "recorrencia_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recorrencia" ADD CONSTRAINT "recorrencia_cartao_id_cartao_id_fk" FOREIGN KEY ("cartao_id") REFERENCES "public"."cartao"("id") ON DELETE no action ON UPDATE no action;
