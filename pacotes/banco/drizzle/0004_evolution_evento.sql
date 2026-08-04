CREATE TABLE "evolution_evento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evento" text NOT NULL,
	"instancia" text NOT NULL,
	"payload" jsonb NOT NULL,
	"data_evento" timestamp with time zone,
	"data_criacao" timestamp with time zone DEFAULT now() NOT NULL
);
