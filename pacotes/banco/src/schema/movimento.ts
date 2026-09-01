import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  classificadoPorEnum,
  formaPagamentoEnum,
  papelConhecimentoEnum,
  perfilEnum,
  statusFonteEnum,
  statusMovimentoEnum,
  tipoFonteEnum,
  tipoMovimentoEnum,
} from "./enums";
import { conta } from "./conta";
import { cartao } from "./cartao";
import { categoria } from "./categoria";
import { pessoa } from "./pessoa";
import { regra } from "./regra";
import { usuario } from "./usuario";
import { workspace } from "./workspace";

/**
 * Qualquer evento financeiro registrado. Nunca chamar de "transação".
 *
 * A tabela tem dois grupos de colunas com regras de escrita diferentes (ADR-009):
 * o FATO FINANCEIRO é o que veio da instituição e é imutável quando
 * `fonte = 'open_finance'`; o CONHECIMENTO DO LANÇAI é sempre mutável.
 * A fronteira é imposta por um trigger no Postgres, não por disciplina.
 */
export const movimento = pgTable(
  "movimento",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id),

    // -------------------------------------------------------------------
    // FATO FINANCEIRO — imutável quando fonte = 'open_finance'
    // -------------------------------------------------------------------

    /** Origem da movimentação. O Core armazena e não interpreta. */
    fonte: tipoFonteEnum("fonte").notNull().default("manual"),
    /** Rótulo opaco do provedor (ex.: 'pluggy'). Nenhum módulo fora de open-finance interpreta. */
    provedor: text("provedor"),
    /** Identificador na instituição ou hash do arquivo importado. Chave de deduplicação. */
    idExterno: text("id_externo"),
    /** Armazenado como string decimal (numeric do Postgres) para evitar perda de precisão. */
    valor: numeric("valor", { precision: 14, scale: 2 }).notNull(),
    tipo: tipoMovimentoEnum("tipo").notNull(),
    status: statusMovimentoEnum("status").notNull().default("realizado"),
    /**
     * Meio de pagamento (pix, crédito, débito…). Independente de `tipo`.
     * Pode ser null em lançamentos antigos ou quando a mensagem não deixou claro.
     */
    formaPagamento: formaPagamentoEnum("forma_pagamento"),
    dataMovimento: date("data_movimento").notNull(),
    /**
     * Instante informado pela instituição, quando ela manda hora além do dia.
     * Nulo se a fonte só trouxe a data. Ordena o extrato como no banco, sem
     * mudar a competência (`data_movimento`).
     */
    ocorridoEmInstante: timestamp("ocorrido_em_instante", { withTimezone: true }),
    contaId: uuid("conta_id").references(() => conta.id),
    cartaoId: uuid("cartao_id").references(() => cartao.id),
    /** Descrição original da instituição ou do lançamento. Nunca reescrita. */
    descricaoFonte: text("descricao_fonte").notNull(),
    favorecidoFonte: text("favorecido_fonte"),
    /** Situação na instituição — diferente de `status`, que é do LançAI. */
    statusFonte: statusFonteEnum("status_fonte").notNull().default("confirmado"),
    /** Hash determinístico da identidade financeira + dados da transação. Usado para deduplicação robusta quando idExterno muda (reatachar). */
    fingerprint: text("fingerprint"),

    /**
     * O que a instituição afirma sobre o parcelamento desta compra no cartão.
     * Nulo em tudo que não é parcela, que é a esmagadora maioria.
     *
     * Não confundir com a tabela `parcela`: lá o modelo é um movimento pai e N
     * filhas, que é como o lançamento manual funciona. Aqui cada parcela chega
     * da instituição como transação independente e vira um Fato próprio — não
     * existe pai para apontar. Agrupar as parcelas de uma mesma compra é
     * trabalho do Conhecimento, e estas quatro colunas são o que ele usa.
     */
    parcelaNumero: integer("parcela_numero"),
    parcelaTotal: integer("parcela_total"),
    /** Data da compra original, anterior à data desta parcela. */
    parcelaCompraEm: date("parcela_compra_em"),
    /** Valor da compra inteira. Guardado porque parcela desigual não multiplica. */
    parcelaCompraValor: numeric("parcela_compra_valor", { precision: 14, scale: 2 }),

    // -------------------------------------------------------------------
    // CONHECIMENTO DO LANÇAI — sempre mutável, inclusive em conta sincronizada
    // -------------------------------------------------------------------

    /** Versão enxuta usada na conversa e na interface. Editável; `descricao_fonte` guarda o original. */
    descricao: text("descricao").notNull(),
    categoriaId: uuid("categoria_id")
      .notNull()
      .references(() => categoria.id),
    pessoaId: uuid("pessoa_id").references(() => pessoa.id),
    /**
     * Pessoal (`pf`) ou empresa (`pj`) — independente do perfil da conta/cartão.
     * Conta PJ com gasto pessoal (Mercado Pago + churrasco) é `pf` aqui.
     */
    tipoGasto: perfilEnum("tipo_gasto").notNull(),
    tags: text("tags").array().notNull().default([]),
    observacoes: text("observacoes"),
    /** Impede que uma regra sobrescreva o que a pessoa classificou à mão. */
    classificadoPor: classificadoPorEnum("classificado_por").notNull().default("usuario"),
    /**
     * Qual regra produziu a classificação. Nulo quando veio da IA ou do usuário.
     * `ON DELETE SET NULL`: apagar a regra não apaga o Fato nem a categoria.
     */
    regraId: uuid("regra_id").references(() => regra.id, { onDelete: "set null" }),
    /** Quando a origem da classificação mudou pela última vez — sustenta a explicabilidade. */
    classificadoEm: timestamp("classificado_em", { withTimezone: true }),
    /** Entre 0 e 1. Alimenta a fila de revisão de baixa confiança. */
    confiancaIa: numeric("confianca_ia", { precision: 4, scale: 3 }),
    /** Esconde das agregações sem tocar no Fato. É a saída para "apagar" algo vindo do banco. */
    ignoradoEmRelatorio: boolean("ignorado_em_relatorio").notNull().default(false),
    /**
     * Par no mesmo minuto (conta, valor, tipo, descrição). O Extrato pergunta
     * se é repetido. `true` + `ignorado_em_relatorio` = a pessoa disse que não
     * mantém; a linha some sem apagar o Fato.
     */
    possivelRepetido: boolean("possivel_repetido").notNull().default(false),
    /**
     * Interpretação do lançamento. `pagamento_fatura` some dos totais (via
     * `ignorado_em_relatorio`) sem mudar o Fato — o dinheiro saiu da conta.
     */
    papel: papelConhecimentoEnum("papel").notNull().default("gasto"),
    /** Cartão cuja fatura esta linha quitou — opcional, só com `papel = pagamento_fatura`. */
    cartaoFaturaId: uuid("cartao_fatura_id").references(() => cartao.id, { onDelete: "set null" }),
    /** Competência da fatura quitada (`YYYY-MM`). */
    competenciaFatura: text("competencia_fatura"),

    // -------------------------------------------------------------------
    // Auditoria
    // -------------------------------------------------------------------

    dataLancamento: timestamp("data_lancamento", { withTimezone: true }).notNull().defaultNow(),
    usuarioId: uuid("usuario_id")
      .notNull()
      .references(() => usuario.id),
    dataCriacao: timestamp("data_criacao", { withTimezone: true }).notNull().defaultNow(),
    dataAtualizacao: timestamp("data_atualizacao", { withTimezone: true }).notNull().defaultNow(),
    criadoPor: uuid("criado_por")
      .notNull()
      .references(() => usuario.id),
    alteradoPor: uuid("alterado_por").references(() => usuario.id),
  },
  (tabela) => [
    /**
     * Deduplicação de ingestão: reprocessar o mesmo lote não duplica movimento.
     * Parcial porque lançamentos manuais não têm `id_externo` e podem repetir
     * legitimamente (dois cafés de R$ 8 no mesmo dia).
     */
    uniqueIndex("movimento_id_externo_unico")
      .on(tabela.workspaceId, tabela.fonte, tabela.provedor, tabela.idExterno)
      .where(sql`${tabela.idExterno} is not null`),
    /**
     * Lookup de reidentificação quando idExterno muda (reatachar). Não é único:
     * duas compras iguais no mesmo dia compartilham o hash.
     */
    index("movimento_fingerprint_idx")
      .on(tabela.fingerprint)
      .where(sql`${tabela.fingerprint} is not null`),
    index("movimento_workspace_data_idx").on(tabela.workspaceId, tabela.dataMovimento),
  ],
);

export type Movimento = typeof movimento.$inferSelect;
export type NovoMovimento = typeof movimento.$inferInsert;
