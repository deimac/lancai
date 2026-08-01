CREATE TYPE "public"."acao_auditoria" AS ENUM('INSERCAO', 'ALTERACAO', 'CANCELAMENTO');--> statement-breakpoint
CREATE TYPE "public"."papel_chat" AS ENUM('usuario', 'sistema', 'ia');--> statement-breakpoint
CREATE TYPE "public"."perfil" AS ENUM('pf', 'pj');--> statement-breakpoint
CREATE TYPE "public"."status_movimento" AS ENUM('previsto', 'realizado', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."status_sessao" AS ENUM('ativa', 'encerrada');--> statement-breakpoint
CREATE TYPE "public"."tipo_categoria" AS ENUM('receita', 'despesa', 'ambos');--> statement-breakpoint
CREATE TYPE "public"."tipo_movimento" AS ENUM('receita', 'despesa', 'transferencia', 'reembolso', 'emprestimo', 'estorno', 'retirada', 'aporte');--> statement-breakpoint
CREATE TYPE "public"."tipo_pessoa" AS ENUM('cliente', 'fornecedor', 'socio', 'funcionario', 'familiar');--> statement-breakpoint
CREATE TABLE "usuario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"email" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"data_criacao" timestamp with time zone DEFAULT now() NOT NULL,
	"data_atualizacao" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuario_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "conta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"saldo_inicial" numeric(14, 2) DEFAULT 0 NOT NULL,
	"saldo_atual" numeric(14, 2) DEFAULT 0 NOT NULL,
	"perfil" "perfil" NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"usuario_id" uuid NOT NULL,
	"data_criacao" timestamp with time zone DEFAULT now() NOT NULL,
	"data_atualizacao" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cartao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"limite" numeric(14, 2) NOT NULL,
	"fechamento" integer NOT NULL,
	"vencimento" integer NOT NULL,
	"melhor_dia_compra" integer NOT NULL,
	"perfil" "perfil" NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"conta_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	"data_criacao" timestamp with time zone DEFAULT now() NOT NULL,
	"data_atualizacao" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categoria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"tipo" "tipo_categoria" NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"usuario_id" uuid NOT NULL,
	"data_criacao" timestamp with time zone DEFAULT now() NOT NULL,
	"data_atualizacao" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pessoa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"tipo" "tipo_pessoa" NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"usuario_id" uuid NOT NULL,
	"data_criacao" timestamp with time zone DEFAULT now() NOT NULL,
	"data_atualizacao" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movimento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"descricao" text NOT NULL,
	"valor" numeric(14, 2) NOT NULL,
	"tipo" "tipo_movimento" NOT NULL,
	"status" "status_movimento" DEFAULT 'realizado' NOT NULL,
	"perfil" "perfil" NOT NULL,
	"data_movimento" date NOT NULL,
	"data_lancamento" timestamp with time zone DEFAULT now() NOT NULL,
	"conta_id" uuid,
	"cartao_id" uuid,
	"categoria_id" uuid NOT NULL,
	"pessoa_id" uuid,
	"usuario_id" uuid NOT NULL,
	"data_criacao" timestamp with time zone DEFAULT now() NOT NULL,
	"data_atualizacao" timestamp with time zone DEFAULT now() NOT NULL,
	"criado_por" uuid NOT NULL,
	"alterado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "parcela" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"movimento_id" uuid NOT NULL,
	"numero_parcela" integer NOT NULL,
	"valor" numeric(14, 2) NOT NULL,
	"data_movimento" date NOT NULL,
	"status" "status_movimento" DEFAULT 'previsto' NOT NULL,
	"data_criacao" timestamp with time zone DEFAULT now() NOT NULL,
	"data_atualizacao" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memoria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chave" text NOT NULL,
	"valor" text NOT NULL,
	"usuario_id" uuid NOT NULL,
	"data_criacao" timestamp with time zone DEFAULT now() NOT NULL,
	"data_atualizacao" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auditoria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tabela" text NOT NULL,
	"registro_id" uuid NOT NULL,
	"acao" "acao_auditoria" NOT NULL,
	"estado_anterior" jsonb,
	"estado_atual" jsonb,
	"alterado_por" uuid NOT NULL,
	"data_criacao" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"status" "status_sessao" DEFAULT 'ativa' NOT NULL,
	"data_criacao" timestamp with time zone DEFAULT now() NOT NULL,
	"data_atualizacao" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sessao_id" uuid NOT NULL,
	"papel" "papel_chat" NOT NULL,
	"conteudo" text NOT NULL,
	"intencao_detectada" jsonb,
	"data_criacao" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conta" ADD CONSTRAINT "conta_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cartao" ADD CONSTRAINT "cartao_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cartao" ADD CONSTRAINT "cartao_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categoria" ADD CONSTRAINT "categoria_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pessoa" ADD CONSTRAINT "pessoa_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimento" ADD CONSTRAINT "movimento_conta_id_conta_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."conta"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimento" ADD CONSTRAINT "movimento_cartao_id_cartao_id_fk" FOREIGN KEY ("cartao_id") REFERENCES "public"."cartao"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimento" ADD CONSTRAINT "movimento_categoria_id_categoria_id_fk" FOREIGN KEY ("categoria_id") REFERENCES "public"."categoria"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimento" ADD CONSTRAINT "movimento_pessoa_id_pessoa_id_fk" FOREIGN KEY ("pessoa_id") REFERENCES "public"."pessoa"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimento" ADD CONSTRAINT "movimento_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimento" ADD CONSTRAINT "movimento_criado_por_usuario_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimento" ADD CONSTRAINT "movimento_alterado_por_usuario_id_fk" FOREIGN KEY ("alterado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcela" ADD CONSTRAINT "parcela_movimento_id_movimento_id_fk" FOREIGN KEY ("movimento_id") REFERENCES "public"."movimento"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memoria" ADD CONSTRAINT "memoria_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_alterado_por_usuario_id_fk" FOREIGN KEY ("alterado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessao" ADD CONSTRAINT "sessao_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_sessao_id_sessao_id_fk" FOREIGN KEY ("sessao_id") REFERENCES "public"."sessao"("id") ON DELETE no action ON UPDATE no action;