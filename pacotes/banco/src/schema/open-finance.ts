import { foreignKey, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { cartao } from "./cartao";
import { conta } from "./conta";
import { contaFinanceira } from "./conta-financeira";
import { motivoAtencaoEnum, statusConexaoEnum } from "./enums";
import { usuario } from "./usuario";
import { workspace } from "./workspace";

/**
 * Estas três tabelas pertencem a `modulos/open-finance` e nenhum outro módulo as
 * lê. Ficam aqui porque o schema do Drizzle é único no projeto, não porque são
 * do Core — a fronteira do ADR-011 é de dependência de código, não de arquivo.
 */

/**
 * Uma conexão do usuário com uma instituição, na conta dele no provedor.
 *
 * Modelo de produto: a conexão pertence ao usuário (`criado_por` / clientUserId
 * Pluggy = usuarioId). `workspace_id` é pouso técnico do workspace ativo no
 * registro — necessário hoje para materializar Conta/Cartão/Movimento — e não
 * deve ser lido como “dono” da conexão. Follow-up: ownership só no usuário.
 */
export const openFinanceConexao = pgTable(
  "open_finance_conexao",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Pouso técnico (workspace ativo no registro). Não é o dono da conexão. */
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id),
    /**
     * Quem conectou (= dono da conexão no modelo de produto). A ingestão
     * precisa de um autor para o Fato e para a auditoria; webhook não tem
     * usuário logado.
     */
    criadoPor: uuid("criado_por")
      .notNull()
      .references(() => usuario.id),
    /** Rótulo opaco do provedor ("pluggy"). Ninguém fora do módulo interpreta. */
    provedor: text("provedor").notNull(),
    /** Identificador da conexão no provedor (o `itemId` da Pluggy). */
    idExterno: text("id_externo").notNull(),
    /** Nome da instituição, só para a interface ter o que mostrar. */
    instituicao: text("instituicao"),
    status: statusConexaoEnum("status").notNull().default("ativa"),
    motivoAtencao: motivoAtencaoEnum("motivo_atencao"),
    /** Nulo significa consentimento sem expiração, o padrão da Pluggy. */
    consentimentoExpiraEm: timestamp("consentimento_expira_em", { withTimezone: true }),
    /** Alimenta a observabilidade da seção 7 de 13-OPEN_FINANCE.md. */
    ultimoSyncEm: timestamp("ultimo_sync_em", { withTimezone: true }),
    /**
     * Contagens do último lote processado (criados, duplicados, etc.). A UI
     * mostra isto; o detalhe por execução continua no log da API.
     */
    ultimoResumoIngestao: jsonb("ultimo_resumo_ingestao").$type<{
      criados: number;
      duplicados: number;
      atualizados: number;
      removidos: number;
      semDestino: number;
      paginas: number;
    }>(),
    /**
     * Ajustes que só fazem sentido para o provedor — importar pendentes, qual
     * campo usar como favorecido. São conceitos de provedor, e é por isso que
     * não são colunas do Core.
     */
    configuracoes: jsonb("configuracoes").notNull().default({}),
    dataCriacao: timestamp("data_criacao", { withTimezone: true }).notNull().defaultNow(),
    dataAtualizacao: timestamp("data_atualizacao", { withTimezone: true }).notNull().defaultNow(),
  },
  (tabela) => [unique("open_finance_conexao_unica").on(tabela.provedor, tabela.idExterno)],
);

/**
 * Mapa da conta no provedor para a conta local. Sem uma linha aqui, o evento não
 * tem onde pousar e a ingestão o descarta — é o que impede o webhook de criar
 * conta sozinho.
 */
export const openFinanceContaExterna = pgTable(
  "open_finance_conta_externa",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conexaoId: uuid("conexao_id").notNull(),
    idExterno: text("id_externo").notNull(),
    nome: text("nome").notNull(),
    /** Tipo como o provedor chama. Opaco de propósito. */
    tipo: text("tipo").notNull(),
    contaId: uuid("conta_id").references(() => conta.id),
    cartaoId: uuid("cartao_id").references(() => cartao.id),
    contaFinanceiraId: uuid("conta_financeira_id").references(() => contaFinanceira.id),
    dataCriacao: timestamp("data_criacao", { withTimezone: true }).notNull().defaultNow(),
    dataAtualizacao: timestamp("data_atualizacao", { withTimezone: true }).notNull().defaultNow(),
  },
  (tabela) => [
    unique("open_finance_conta_externa_unica").on(tabela.conexaoId, tabela.idExterno),
    /**
     * Nomeada à mão porque o nome que o Drizzle deriva passa de 63 caracteres e
     * o Postgres o truncaria, deixando snapshot e banco divergentes.
     */
    foreignKey({
      name: "open_finance_conta_externa_conexao_fk",
      columns: [tabela.conexaoId],
      foreignColumns: [openFinanceConexao.id],
    }),
  ],
);

/**
 * Webhook bruto, gravado antes de qualquer processamento — mesmo padrão de
 * `evolution_evento`. A unicidade de `evento_id` é o que torna a retentativa do
 * provedor inofensiva: até nove chegam para o mesmo evento.
 */
export const openFinanceEvento = pgTable(
  "open_finance_evento",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provedor: text("provedor").notNull(),
    /** Identificador do evento no provedor. Chave de idempotência do handler. */
    eventoId: text("evento_id").notNull(),
    /** Nome do evento como o provedor manda. Cru aqui, traduzido no adaptador. */
    tipo: text("tipo").notNull(),
    payload: jsonb("payload").notNull(),
    processadoEm: timestamp("processado_em", { withTimezone: true }),
    /** Mensagem da última falha de processamento, para o cron de reprocesso. */
    erro: text("erro"),
    dataCriacao: timestamp("data_criacao", { withTimezone: true }).notNull().defaultNow(),
  },
  (tabela) => [unique("open_finance_evento_unico").on(tabela.provedor, tabela.eventoId)],
);

export type OpenFinanceConexao = typeof openFinanceConexao.$inferSelect;
export type NovaOpenFinanceConexao = typeof openFinanceConexao.$inferInsert;
export type OpenFinanceContaExterna = typeof openFinanceContaExterna.$inferSelect;
export type NovaOpenFinanceContaExterna = typeof openFinanceContaExterna.$inferInsert;
export type OpenFinanceEvento = typeof openFinanceEvento.$inferSelect;
export type NovoOpenFinanceEvento = typeof openFinanceEvento.$inferInsert;
