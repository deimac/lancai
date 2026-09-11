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

/**
 * Confiança da alocação transação↔fatura. `confirmado` só existe com evidência
 * L0 (`providerBillId`); os demais são estimativa e nunca entram como certeza.
 */
export const statusAlocacaoFaturaEnum = pgEnum("status_alocacao_fatura", [
  "confirmado",
  "previsto",
  "possivel",
  "nao_resolvido",
]);

/** Como a alocação foi decidida. Nunca usado como autoridade sozinho — só o `status` é. */
export const metodoAlocacaoFaturaEnum = pgEnum("metodo_alocacao_fatura", [
  "provider_bill_id",
  "provider_forecast",
  "regra_ciclo",
  "historico",
  "correspondencia",
  "manual",
  "nao_resolvido",
]);

/**
 * Estado do conflito de alocação (ex.: `providerBillId` apontando para mais de
 * uma fatura). Resolução é sempre manual e explícita — nunca automática.
 */
export const estadoConflitoAlocacaoEnum = pgEnum("estado_conflito_alocacao", [
  "nenhum",
  "conflito",
  "resolvido",
]);

/** Origem da mudança registrada no log de auditoria da alocação. */
export const origemAuditoriaAlocacaoEnum = pgEnum("origem_auditoria_alocacao", [
  "sistema",
  "provedor",
  "usuario",
]);

export const papelChatEnum = pgEnum("papel_chat", ["usuario", "sistema", "ia"]);

/** Crédito puro, débito puro, ou plástico que aceita os dois (com conta vinculada). */
export const modalidadeCartaoEnum = pgEnum("modalidade_cartao", ["credito", "debito", "multiplo"]);

/** Meio usado no lançamento — independente do `tipo_movimento` (receita/despesa/…). */
export const formaPagamentoEnum = pgEnum("forma_pagamento", [
  "pix",
  "transferencia",
  "boleto",
  "dinheiro",
  "credito",
  "debito",
]);

/**
 * Origem da movimentação (ADR-010). Toda fonte entrega o mesmo evento normalizado;
 * o Core não sabe de onde veio. `ofx`/`csv` estão reservados. `pdf` é a importação
 * de fatura/extrato em conta ou cartão manuais.
 */
export const tipoFonteEnum = pgEnum("tipo_fonte", [
  "open_finance",
  "manual",
  "whatsapp",
  "api",
  "recorrencia",
  "ofx",
  "csv",
  "pdf",
]);

/**
 * Situação da transação na instituição — diferente do `status_movimento` do
 * LançAI. `removido` é o que a instituição diz depois de desfazer a transação;
 * a consequência disso aqui é `status = 'cancelado'`, que é coisa nossa.
 */
export const statusFonteEnum = pgEnum("status_fonte", ["confirmado", "pendente", "removido"]);

/**
 * Quem definiu a classificação. `usuario` tem precedência: uma regra nunca
 * sobrescreve o que a pessoa classificou à mão.
 */
export const classificadoPorEnum = pgEnum("classificado_por", ["regra", "ia", "usuario"]);

/**
 * Override de regra sobre o efeito financeiro do lançamento: `soma` se
 * comporta como despesa (aumenta fatura, sai do caixa); `subtrai` se
 * comporta como crédito (abate fatura, entra no caixa). Nulo = usa o
 * comportamento padrão do `tipo` (despesa/receita/estorno/…).
 */
export const efeitoValorEnum = pgEnum("efeito_valor", ["soma", "subtrai"]);

/** Como a regra nasceu. `aprendizado_conversa` é o "virar regra?" da F3. */
export const origemRegraEnum = pgEnum("origem_regra", ["manual", "aprendizado_conversa"]);

/**
 * Como a recorrência entrou: a pessoa cadastrou, ou o cron materializou um
 * padrão estável do extrato (Open Finance que só chega na fatura fechada).
 */
export const origemRecorrenciaEnum = pgEnum("origem_recorrencia", ["cadastro", "detectada"]);

/**
 * Legado v1. O builder novo usa `condicoes` JSONB; este enum só permanece
 * para colunas antigas ainda presentes após o backfill.
 */
export const tipoCondicaoRegraEnum = pgEnum("tipo_condicao_regra", ["descricao_contem"]);

/** Combina as linhas de condição da regra. */
export const logicaCondicoesRegraEnum = pgEnum("logica_condicoes_regra", ["e", "ou"]);

/**
 * Estado de uma conexão com instituição financeira, em vocabulário nosso.
 * O status do provedor é traduzido para cá pelo adaptador — ver ADR-011.
 */
export const statusConexaoEnum = pgEnum("status_conexao", [
  "ativa",
  "sincronizando",
  "precisa_atencao",
  "removida",
]);

/** Por que a conexão precisa de atenção. É isto que a interface traduz em ação. */
export const motivoAtencaoEnum = pgEnum("motivo_atencao", [
  "credencial_invalida",
  "consentimento_revogado",
  "aguardando_usuario",
  "erro_no_provedor",
]);

export const papelWorkspaceEnum = pgEnum("papel_workspace", ["dono", "editor", "leitor"]);

/** Preferência do painel do assistente no cockpit web. */
export const posicaoPainelEnum = pgEnum("posicao_painel", ["lateral", "inferior"]);

/**
 * Papel do lançamento no Conhecimento (ADR-009). O Fato continua débito/crédito
 * da instituição; `pagamento_fatura` só interpreta a linha como quitação.
 */
export const papelConhecimentoEnum = pgEnum("papel_conhecimento", ["gasto", "pagamento_fatura"]);
