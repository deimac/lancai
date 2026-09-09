import { sql } from "drizzle-orm";
import {
    boolean,
    check,
    index,
    integer,
    jsonb,
    numeric,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
    uuid,
} from "drizzle-orm/pg-core";
import {
    estadoConflitoAlocacaoEnum,
    metodoAlocacaoFaturaEnum,
    statusAlocacaoFaturaEnum,
} from "./enums";
import { cartao } from "./cartao";
import { faturaOficial } from "./fatura-oficial";
import { movimento } from "./movimento";
import { usuario } from "./usuario";
import { workspace } from "./workspace";

/**
 * Vínculo explícito transação↔fatura (`BillAllocation`), com histórico.
 *
 * Cada movimento tem no máximo UMA alocação atual (`isCurrent`) — rateio e
 * múltiplas alocações atuais estão fora de escopo. Quando a previsão muda
 * (nova competência) ou é confirmada, a alocação atual é encerrada
 * (`validoAte` + `isCurrent = false`) e uma nova é criada, preservando o rastro.
 *
 * `faturaOficialId` só existe depois que a fatura fecha; até lá o alvo é
 * `cartaoId` + `competencia` (YYYY-MM), sem entidade de fatura aberta ainda
 * (ver Fase 2 do plano — Bill Forecast Engine).
 */
export const alocacaoFatura = pgTable(
    "bill_allocation",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        workspaceId: uuid("workspace_id")
            .notNull()
            .references(() => workspace.id),
        movimentoId: uuid("movimento_id")
            .notNull()
            .references(() => movimento.id),
        cartaoId: uuid("cartao_id")
            .notNull()
            .references(() => cartao.id),
        /** Competência alvo (YYYY-MM), ausente quando a alocação é não resolvida. */
        competencia: text("competencia"),
        /** Preenchido quando a fatura já fechou e existe `fatura_oficial` correspondente. */
        faturaOficialId: uuid("fatura_oficial_id").references(() => faturaOficial.id),
        status: statusAlocacaoFaturaEnum("status").notNull(),
        metodo: metodoAlocacaoFaturaEnum("metodo").notNull(),
        /** 0-100, informativo. Nunca é lido como autoridade — `status`/`metodo` são. */
        confidenceScore: integer("confidence_score"),
        /** Fotografia do valor alocado no momento da decisão. */
        valorAlocado: numeric("valor_alocado", { precision: 14, scale: 2 }),
        validoDesde: timestamp("valido_desde", { withTimezone: true }).notNull().defaultNow(),
        validoAte: timestamp("valido_ate", { withTimezone: true }),
        isCurrent: boolean("is_current").notNull().default(true),
        /** `NONE | CONFLICT | RESOLVED` — resolução é sempre manual e explícita. */
        estadoConflito: estadoConflitoAlocacaoEnum("estado_conflito").notNull().default("nenhum"),
        /** Motivo do conflito, para a pendência de auditoria mostrar ao usuário. */
        conflitoMotivo: text("conflito_motivo"),
        /** Alternativas e dados de origem em disputa, preservados para auditoria. */
        conflitoDadosOrigem: jsonb("conflito_dados_origem"),
        resolvidoPor: uuid("resolvido_por").references(() => usuario.id),
        resolvidoEm: timestamp("resolvido_em", { withTimezone: true }),
        dataCriacao: timestamp("data_criacao", { withTimezone: true }).notNull().defaultNow(),
        dataAtualizacao: timestamp("data_atualizacao", { withTimezone: true }).notNull().defaultNow(),
    },
    (tabela) => [
        /** Regra de ouro: no máximo uma alocação atual por transação. */
        uniqueIndex("bill_allocation_movimento_atual_unico")
            .on(tabela.movimentoId)
            .where(sql`${tabela.isCurrent}`),
        index("bill_allocation_cartao_competencia_idx").on(tabela.cartaoId, tabela.competencia),
        index("bill_allocation_fatura_oficial_idx")
            .on(tabela.faturaOficialId)
            .where(sql`${tabela.faturaOficialId} is not null`),
        check(
            "bill_allocation_competencia_status_check",
            sql`("status" = 'nao_resolvido' AND "competencia" IS NULL) OR ("status" <> 'nao_resolvido' AND "competencia" IS NOT NULL)`,
        ),
    ],
);

export type AlocacaoFatura = typeof alocacaoFatura.$inferSelect;
export type NovaAlocacaoFatura = typeof alocacaoFatura.$inferInsert;
