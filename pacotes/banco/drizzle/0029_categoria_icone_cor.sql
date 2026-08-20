-- Apresentação das categorias: ícone e cor (não mudam o modelo financeiro).

ALTER TABLE "categoria" ADD COLUMN "icone" text DEFAULT 'geral' NOT NULL;--> statement-breakpoint
ALTER TABLE "categoria" ADD COLUMN "cor" text DEFAULT 'neutro' NOT NULL;--> statement-breakpoint

UPDATE "categoria" SET "icone" = 'geral', "cor" = 'neutro'
WHERE lower("nome") = 'não classificado';--> statement-breakpoint
UPDATE "categoria" SET "icone" = 'fatura', "cor" = 'azul'
WHERE lower("nome") = 'pagamento de fatura';--> statement-breakpoint
UPDATE "categoria" SET "icone" = 'restaurante', "cor" = 'laranja'
WHERE lower("nome") = 'alimentação';--> statement-breakpoint
UPDATE "categoria" SET "icone" = 'combustivel', "cor" = 'ambar'
WHERE lower("nome") = 'combustível';--> statement-breakpoint
UPDATE "categoria" SET "icone" = 'carro', "cor" = 'azul'
WHERE lower("nome") = 'transporte';--> statement-breakpoint
UPDATE "categoria" SET "icone" = 'casa', "cor" = 'violeta'
WHERE lower("nome") = 'moradia';--> statement-breakpoint
UPDATE "categoria" SET "icone" = 'saude', "cor" = 'rosa'
WHERE lower("nome") = 'saúde';--> statement-breakpoint
UPDATE "categoria" SET "icone" = 'lazer', "cor" = 'turquesa'
WHERE lower("nome") = 'lazer';--> statement-breakpoint
UPDATE "categoria" SET "icone" = 'streaming', "cor" = 'ardosia'
WHERE lower("nome") = 'assinaturas';--> statement-breakpoint
UPDATE "categoria" SET "icone" = 'viagem', "cor" = 'azul'
WHERE lower("nome") = 'viagens';--> statement-breakpoint
UPDATE "categoria" SET "icone" = 'educacao', "cor" = 'verde'
WHERE lower("nome") = 'educação';--> statement-breakpoint
UPDATE "categoria" SET "icone" = 'impostos', "cor" = 'ambar'
WHERE lower("nome") = 'impostos';--> statement-breakpoint
UPDATE "categoria" SET "icone" = 'salario', "cor" = 'verde'
WHERE lower("nome") = 'salário';--> statement-breakpoint
UPDATE "categoria" SET "icone" = 'vendas', "cor" = 'verde'
WHERE lower("nome") = 'vendas';--> statement-breakpoint
UPDATE "categoria" SET "icone" = 'servicos', "cor" = 'turquesa'
WHERE lower("nome") = 'serviços prestados';--> statement-breakpoint
UPDATE "categoria" SET "icone" = 'tag', "cor" = 'neutro'
WHERE lower("nome") = 'outros';
