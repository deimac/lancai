import { z } from "zod";
import { perfilSchema } from "./cadastro";

export const tipoMovimentoSchema = z.enum([
  "receita",
  "despesa",
  "transferencia",
  "reembolso",
  "emprestimo",
  "estorno",
  "retirada",
  "aporte",
]);
export type TipoMovimento = z.infer<typeof tipoMovimentoSchema>;

export const statusMovimentoSchema = z.enum(["previsto", "realizado", "cancelado"]);
export type StatusMovimento = z.infer<typeof statusMovimentoSchema>;

const dataISOSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato YYYY-MM-DD");

export const schemaParcelamento = z.object({
  quantidadeParcelas: z.number().int().min(2).max(360),
});
export type EntradaParcelamento = z.infer<typeof schemaParcelamento>;

/**
 * DTO usado pelo `MotorFinanceiro.criar_movimento`. Já espera IDs resolvidos
 * (a resolução de "nome da conta" -> id acontece no `InterpretadorIntencoes`, Fase 3).
 *
 * `tipo === 'transferencia'` é o único caso que exige `contaDestinoId`: o motor
 * cria duas linhas de `movimento` (débito na conta de origem, crédito na conta
 * de destino) dentro da mesma transação — não existe coluna própria para
 * "transferência" no schema, pois cada linha de `movimento` já é auto-suficiente
 * para o cálculo de saldo.
 */
export const schemaCriarMovimento = z
  .object({
    descricao: z.string().min(1),
    valor: z.number().positive(),
    tipo: tipoMovimentoSchema,
    status: statusMovimentoSchema.default("realizado"),
    perfil: perfilSchema,
    dataMovimento: dataISOSchema,
    contaId: z.string().uuid().optional(),
    cartaoId: z.string().uuid().optional(),
    contaDestinoId: z.string().uuid().optional(),
    categoriaId: z.string().uuid(),
    pessoaId: z.string().uuid().optional(),
    usuarioId: z.string().uuid(),
    criadoPor: z.string().uuid(),
    parcelamento: schemaParcelamento.optional(),
  })
  .refine((dado) => Boolean(dado.contaId) || Boolean(dado.cartaoId), {
    message: "Informe contaId ou cartaoId",
    path: ["contaId"],
  })
  .refine((dado) => dado.tipo !== "transferencia" || Boolean(dado.contaId), {
    message: "Transferência exige contaId de origem",
    path: ["contaId"],
  })
  .refine((dado) => dado.tipo !== "transferencia" || Boolean(dado.contaDestinoId), {
    message: "Transferência exige contaDestinoId",
    path: ["contaDestinoId"],
  })
  .refine((dado) => dado.tipo !== "transferencia" || !dado.cartaoId, {
    message: "Transferência não pode ser feita em cartão",
    path: ["cartaoId"],
  })
  .refine((dado) => !dado.parcelamento || Boolean(dado.cartaoId), {
    message: "Parcelamento neste MVP só é suportado em compras no cartão",
    path: ["parcelamento"],
  });

export type EntradaCriarMovimento = z.infer<typeof schemaCriarMovimento>;

export const schemaCorrigirMovimento = z.object({
  movimentoId: z.string().uuid(),
  alteradoPor: z.string().uuid(),
  campos: z
    .object({
      descricao: z.string().min(1).optional(),
      valor: z.number().positive().optional(),
      dataMovimento: dataISOSchema.optional(),
      categoriaId: z.string().uuid().optional(),
      contaId: z.string().uuid().optional(),
      cartaoId: z.string().uuid().optional(),
      pessoaId: z.string().uuid().optional(),
      perfil: perfilSchema.optional(),
      status: statusMovimentoSchema.optional(),
      /** Regenera o parcelamento da compra no cartão com essa quantidade. */
      parcelas: z.number().int().min(1).max(360).optional(),
    })
    .refine((campos) => Object.keys(campos).length > 0, {
      message: "Informe ao menos um campo para corrigir",
    }),
});
export type EntradaCorrigirMovimento = z.infer<typeof schemaCorrigirMovimento>;
