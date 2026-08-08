-- O cartão informa cada parcela como transação independente, com o número da
-- parcela, o total, o valor da compra e a data da compra original. Antes disto
-- o adaptador jogava esses quatro fora, e recuperá-los depois exigiria recoletar
-- até 365 dias de histórico — barato agora, caro mais tarde.
--
-- Cada parcela continua sendo um Fato próprio. Reconstruir a compra-mãe a partir
-- das parcelas é adivinhação, e adivinhação não produz Fato; agrupar é trabalho
-- do Conhecimento, e estas colunas são a matéria-prima dele.

ALTER TABLE "movimento" ADD COLUMN IF NOT EXISTS "parcela_numero" integer;--> statement-breakpoint
ALTER TABLE "movimento" ADD COLUMN IF NOT EXISTS "parcela_total" integer;--> statement-breakpoint
ALTER TABLE "movimento" ADD COLUMN IF NOT EXISTS "parcela_compra_em" date;--> statement-breakpoint
ALTER TABLE "movimento" ADD COLUMN IF NOT EXISTS "parcela_compra_valor" numeric(14, 2);--> statement-breakpoint

-- As quatro são Fato, então entram na lista que o trigger protege. Coluna de
-- Fato fora desta lista seria silenciosamente editável, que é exatamente o
-- descuido que o trigger existe para não depender de ninguém lembrar.
CREATE OR REPLACE FUNCTION proteger_fato_financeiro() RETURNS trigger AS $$
BEGIN
  IF OLD.fonte <> 'open_finance' THEN
    RETURN NEW;
  END IF;

  IF coalesce(current_setting('lancai.sincronizacao', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.workspace_id         IS DISTINCT FROM OLD.workspace_id
  OR NEW.fonte                IS DISTINCT FROM OLD.fonte
  OR NEW.provedor             IS DISTINCT FROM OLD.provedor
  OR NEW.id_externo           IS DISTINCT FROM OLD.id_externo
  OR NEW.valor                IS DISTINCT FROM OLD.valor
  OR NEW.tipo                 IS DISTINCT FROM OLD.tipo
  OR NEW.status               IS DISTINCT FROM OLD.status
  OR NEW.forma_pagamento      IS DISTINCT FROM OLD.forma_pagamento
  OR NEW.data_movimento       IS DISTINCT FROM OLD.data_movimento
  OR NEW.conta_id             IS DISTINCT FROM OLD.conta_id
  OR NEW.cartao_id            IS DISTINCT FROM OLD.cartao_id
  OR NEW.descricao_fonte      IS DISTINCT FROM OLD.descricao_fonte
  OR NEW.favorecido_fonte     IS DISTINCT FROM OLD.favorecido_fonte
  OR NEW.status_fonte         IS DISTINCT FROM OLD.status_fonte
  OR NEW.parcela_numero       IS DISTINCT FROM OLD.parcela_numero
  OR NEW.parcela_total        IS DISTINCT FROM OLD.parcela_total
  OR NEW.parcela_compra_em    IS DISTINCT FROM OLD.parcela_compra_em
  OR NEW.parcela_compra_valor IS DISTINCT FROM OLD.parcela_compra_valor
  THEN
    RAISE EXCEPTION
      'Fato Financeiro imutável: o movimento % veio de open_finance e só aceita alteração de Conhecimento.',
      OLD.id
      USING ERRCODE = 'LA001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
