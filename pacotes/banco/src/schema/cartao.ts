import { boolean, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { modalidadeCartaoEnum, perfilEnum } from "./enums";
import { conta } from "./conta";
import { contaFinanceira } from "./conta-financeira";
import { usuario } from "./usuario";
import { workspace } from "./workspace";

export const cartao = pgTable("cartao", {
  id: uuid("id").primaryKey().defaultRandom(),
  /**
   * Pouso/agrupador para relatórios. Menu Contas lista todos (`?todos=1`);
   * dashboard/extrato/IA filtram por este campo no escopo ativo.
   */
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspace.id),
  contaFinanceiraId: uuid("conta_financeira_id").references(() => contaFinanceira.id),
  nome: text("nome").notNull(),
  /** Armazenado como string decimal (numeric do Postgres) para evitar perda de precisão. */
  limite: numeric("limite", { precision: 14, scale: 2 }).notNull(),
  /** Saldo devido do cartão (gasto/dívida atual). Conta usa saldo_atual; cartão usa este campo. */
  saldo: numeric("saldo", { precision: 14, scale: 2 }).notNull().default("0"),
  fechamento: integer("fechamento").notNull(),
  vencimento: integer("vencimento").notNull(),
  /** Calculado dinamicamente pelo MotorFinanceiro: dia seguinte ao fechamento. */
  melhorDiaCompra: integer("melhor_dia_compra").notNull(),
  perfil: perfilEnum("perfil").notNull(),
  /**
   * credito = só fatura/limite; debito = só baixa saldo da conta vinculada;
   * multiplo = os dois (conta vinculada obrigatória). Default no cadastro:
   * sem conta → credito; com conta → multiplo.
   */
  modalidade: modalidadeCartaoEnum("modalidade").notNull().default("credito"),
  ativo: boolean("ativo").notNull().default(true),
  /**
   * Cartão alimentado por Open Finance. Quando true, o Fato dos movimentos
   * vindos da sincronização é imutável e a IA só pode enriquecer (ADR-012).
   */
  sincronizada: boolean("sincronizada").notNull().default(false),
  /**
   * Payload AES-256-GCM (base64) com número, validade e CVV.
   * Nunca deve ser devolvido em listagens públicas — só após validar senha no chat.
   * A máscara dos 4 últimos dígitos é derivada na leitura (decifragem), não persistida.
   */
  dadosPlasticosCifrados: text("dados_plasticos_cifrados"),
  /**
   * Conta preferencial para pagar a fatura — opcional. O pagamento da fatura
   * pode usar qualquer conta no momento do lançamento.
   */
  contaId: uuid("conta_id").references(() => conta.id),
  usuarioId: uuid("usuario_id")
    .notNull()
    .references(() => usuario.id),
  dataCriacao: timestamp("data_criacao", { withTimezone: true }).notNull().defaultNow(),
  dataAtualizacao: timestamp("data_atualizacao", { withTimezone: true }).notNull().defaultNow(),
});

export type Cartao = typeof cartao.$inferSelect;
export type NovoCartao = typeof cartao.$inferInsert;
