-- A instituição desfaz transação: estorno de compra, duplicata que ela mesma
-- corrigiu, agendamento cancelado. Isso é afirmação nova da instituição, e por
-- isso mora em `status_fonte`, que é Fato, e não numa marca de Conhecimento.
--
-- A consequência no LançAI é `status = 'cancelado'`: o saldo volta e a linha
-- fica no histórico. Apagar contradiria o ADR-009, e ignorar deixaria no
-- relatório um gasto que o banco diz não existir.

ALTER TYPE "status_fonte" ADD VALUE IF NOT EXISTS 'removido';
