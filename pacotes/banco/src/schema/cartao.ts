import { boolean, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { modalidadeCartaoEnum, perfilEnum } from "./enums";
import { conta } from "./conta";
import { usuario } from "./usuario";

export const cartao = pgTable("cartao", {
  id: uuid("id").primaryKey().defaultRandom(),
  nome: text("nome").notNull(),
  /** Armazenado como string decimal (numeric do Postgres) para evitar perda de precisão. */
  limite: numeric("limite", { precision: 14, scale: 2 }).notNull(),
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
  /** Últimos 4 dígitos do plástico (em claro) — só para identificação na UI. */
  final4: text("final4"),
  /**
   * Payload AES-256-GCM (base64) com número, validade e CVV.
   * Nunca deve ser devolvido em listagens públicas — só após validar senha no chat.
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
