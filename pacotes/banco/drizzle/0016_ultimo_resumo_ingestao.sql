-- Observabilidade do sync: a UI precisa mostrar quantos Fatos o último lote
-- criou / ignorou por duplicata. Antes disto a contagem só existia no log.

ALTER TABLE "open_finance_conexao" ADD COLUMN IF NOT EXISTS "ultimo_resumo_ingestao" jsonb;
