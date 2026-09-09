import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { origemAuditoriaAlocacaoEnum } from "./enums";
import { alocacaoFatura } from "./bill-allocation";
import { usuario } from "./usuario";
import { workspace } from "./workspace";

/**
 * `BillAuditLog` da alocação: por que uma transação mudou de fatura, quem
 * resolveu um conflito, ou quando uma previsão virou confirmação. Histórico
 * append-only — nunca é atualizado nem apagado.
 */
export const auditoriaAlocacaoFatura = pgTable(
    "bill_allocation_audit_log",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        workspaceId: uuid("workspace_id")
            .notNull()
            .references(() => workspace.id),
        alocacaoId: uuid("alocacao_id")
            .notNull()
            .references(() => alocacaoFatura.id),
        /** 'criada' | 'substituida' | 'confirmada' | 'conflito' | 'resolvida' | 'cancelada'. */
        acao: text("acao").notNull(),
        estadoAnterior: jsonb("estado_anterior"),
        estadoNovo: jsonb("estado_novo"),
        origem: origemAuditoriaAlocacaoEnum("origem").notNull(),
        /** Só preenchido quando `origem = 'usuario'` (resolução manual). */
        usuarioId: uuid("usuario_id").references(() => usuario.id),
        dataCriacao: timestamp("data_criacao", { withTimezone: true }).notNull().defaultNow(),
    },
    (tabela) => [index("bill_allocation_audit_log_alocacao_idx").on(tabela.alocacaoId)],
);

export type AuditoriaAlocacaoFatura = typeof auditoriaAlocacaoFatura.$inferSelect;
export type NovaAuditoriaAlocacaoFatura = typeof auditoriaAlocacaoFatura.$inferInsert;
