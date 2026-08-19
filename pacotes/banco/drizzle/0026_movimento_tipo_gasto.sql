-- O perfil da conta/cartão continua sendo quem paga (Física/Jurídica).
-- No lançamento o campo passa a se chamar tipo_gasto: pessoal (pf) vs empresa (pj).

ALTER TABLE "movimento" RENAME COLUMN "perfil" TO "tipo_gasto";
