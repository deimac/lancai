-- Ajuste manual do ciclo de fatura de um lançamento (compra, não pagamento):
-- quantos ciclos deslocar em relação ao que o sistema calcularia sozinho.
-- `1` = próxima fatura, `-1` = fatura anterior, nulo = sem ajuste. Aditivo,
-- não muda comportamento existente. Só cartão manual usa isso na prática.
ALTER TABLE "movimento" ADD COLUMN IF NOT EXISTS "deslocamento_fatura" integer;
