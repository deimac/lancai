-- Override de regra sobre o sinal de um lançamento nos cálculos financeiros
-- (fatura do cartão, fluxo de caixa, resultado do mês). Aditivo: nulo mantém
-- o comportamento atual, decidido pelo `tipo` (despesa/receita/estorno/…).
-- Ver ações `somar_valor`/`subtrair_valor` em @lancai/tipos (regra.ts).

CREATE TYPE "efeito_valor" AS ENUM('soma', 'subtrai');--> statement-breakpoint
ALTER TABLE "movimento" ADD COLUMN IF NOT EXISTS "efeito_valor" "efeito_valor";
