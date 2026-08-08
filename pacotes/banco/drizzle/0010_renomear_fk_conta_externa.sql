-- O nome que o Drizzle derivou para esta foreign key tem 68 caracteres e o
-- Postgres o truncou em 63 ao aplicar a 0009. Nome curto e explícito no schema
-- para que snapshot e banco voltem a concordar — sem isso, uma migração futura
-- que precise remover a constraint falharia por nome inexistente.

ALTER TABLE "open_finance_conta_externa"
  RENAME CONSTRAINT "open_finance_conta_externa_conexao_id_open_finance_conexao_id_f"
  TO "open_finance_conta_externa_conexao_fk";
