-- Terceira camada de garantia do ADR-009: o banco recusa a escrita errada
-- mesmo que o código erre. As outras duas camadas (nomes de coluna agrupados
-- e APIs distintas) são convenção; esta não é.
--
-- Escopo: só movimentos com fonte = 'open_finance'. Lançamento manual continua
-- totalmente corrigível — o Fato ali foi digitado por uma pessoa e pode estar
-- errado. O que veio de instituição financeira não é opinião.
--
-- Exceção: a própria sincronização precisa atualizar o Fato quando a
-- instituição confirma uma transação pendente ou ajusta o valor. Só o módulo
-- open-finance abre essa porta, declarando `SET LOCAL "lancai.sincronizacao"
-- = 'on'` dentro da transação de sync. Fora dali a porta está fechada, e o
-- escopo LOCAL garante que ela feche ao fim da transação.

CREATE OR REPLACE FUNCTION proteger_fato_financeiro() RETURNS trigger AS $$
BEGIN
  IF OLD.fonte <> 'open_finance' THEN
    RETURN NEW;
  END IF;

  IF coalesce(current_setting('lancai.sincronizacao', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.workspace_id      IS DISTINCT FROM OLD.workspace_id
  OR NEW.fonte             IS DISTINCT FROM OLD.fonte
  OR NEW.provedor          IS DISTINCT FROM OLD.provedor
  OR NEW.id_externo        IS DISTINCT FROM OLD.id_externo
  OR NEW.valor             IS DISTINCT FROM OLD.valor
  OR NEW.tipo              IS DISTINCT FROM OLD.tipo
  OR NEW.status            IS DISTINCT FROM OLD.status
  OR NEW.forma_pagamento   IS DISTINCT FROM OLD.forma_pagamento
  OR NEW.data_movimento    IS DISTINCT FROM OLD.data_movimento
  OR NEW.conta_id          IS DISTINCT FROM OLD.conta_id
  OR NEW.cartao_id         IS DISTINCT FROM OLD.cartao_id
  OR NEW.descricao_fonte   IS DISTINCT FROM OLD.descricao_fonte
  OR NEW.favorecido_fonte  IS DISTINCT FROM OLD.favorecido_fonte
  OR NEW.status_fonte      IS DISTINCT FROM OLD.status_fonte
  THEN
    RAISE EXCEPTION
      'Fato Financeiro imutável: o movimento % veio de open_finance e só aceita alteração de Conhecimento.',
      OLD.id
      USING ERRCODE = 'LA001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE OR REPLACE FUNCTION proteger_exclusao_fato_financeiro() RETURNS trigger AS $$
BEGIN
  IF OLD.fonte <> 'open_finance' THEN
    RETURN OLD;
  END IF;

  IF coalesce(current_setting('lancai.sincronizacao', true), 'off') = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION
    'Fato Financeiro imutável: o movimento % veio de open_finance e não pode ser excluído. Use ignorado_em_relatorio.',
    OLD.id
    USING ERRCODE = 'LA001';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS movimento_protege_fato ON "movimento";--> statement-breakpoint
CREATE TRIGGER movimento_protege_fato
  BEFORE UPDATE ON "movimento"
  FOR EACH ROW EXECUTE FUNCTION proteger_fato_financeiro();--> statement-breakpoint

DROP TRIGGER IF EXISTS movimento_protege_exclusao_fato ON "movimento";--> statement-breakpoint
CREATE TRIGGER movimento_protege_exclusao_fato
  BEFORE DELETE ON "movimento"
  FOR EACH ROW EXECUTE FUNCTION proteger_exclusao_fato_financeiro();
