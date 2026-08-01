import { pgEnum } from "drizzle-orm/pg-core";

/** Define se um registro (conta, cartão ou movimento) é pessoal ou empresarial. */
export const perfilEnum = pgEnum("perfil", ["pf", "pj"]);

export const tipoCategoriaEnum = pgEnum("tipo_categoria", ["receita", "despesa", "ambos"]);

export const tipoPessoaEnum = pgEnum("tipo_pessoa", [
  "cliente",
  "fornecedor",
  "socio",
  "funcionario",
  "familiar",
]);

export const tipoMovimentoEnum = pgEnum("tipo_movimento", [
  "receita",
  "despesa",
  "transferencia",
  "reembolso",
  "emprestimo",
  "estorno",
  "retirada",
  "aporte",
]);

/** Usado tanto em `movimento` quanto em `parcela`. */
export const statusMovimentoEnum = pgEnum("status_movimento", [
  "previsto",
  "realizado",
  "cancelado",
]);

export const acaoAuditoriaEnum = pgEnum("acao_auditoria", [
  "INSERCAO",
  "ALTERACAO",
  "CANCELAMENTO",
]);

export const statusSessaoEnum = pgEnum("status_sessao", ["ativa", "encerrada"]);

export const papelChatEnum = pgEnum("papel_chat", ["usuario", "sistema", "ia"]);
