import { z } from "zod";
import { formaPagamentoSchema, perfilSchema } from "./cadastro";
import { classificadoPorSchema, statusFonteSchema, tipoFonteSchema } from "./fonte";

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
    workspaceId: z.string().uuid(),
    /**
     * Origem do lançamento. Só `open_finance` torna o Fato imutável; tudo o
     * mais foi digitado por uma pessoa e continua corrigível.
     */
    fonte: tipoFonteSchema.default("manual"),
    /** Rótulo opaco do provedor. Preenchido apenas por fontes automáticas. */
    provedor: z.string().optional(),
    idExterno: z.string().optional(),
    /** Quando omitido, o motor copia `descricao`. Nunca é reescrito depois. */
    descricaoFonte: z.string().min(1).optional(),
    favorecidoFonte: z.string().optional(),
    statusFonte: statusFonteSchema.optional(),
    descricao: z.string().min(1),
    valor: z.number().positive(),
    tipo: tipoMovimentoSchema,
    status: statusMovimentoSchema.default("realizado"),
    perfil: perfilSchema,
    /**
     * Meio de pagamento. Em conta, omitido vira `pix` no motor.
     * Em cartão, omitido vira `credito` (ou `debito` se explícito).
     */
    formaPagamento: formaPagamentoSchema.nullable().optional(),
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
  })
  .refine((dado) => !dado.parcelamento || dado.formaPagamento !== "debito", {
    message: "Parcelamento só é suportado em compras no crédito",
    path: ["parcelamento"],
  });

export type EntradaCriarMovimento = z.infer<typeof schemaCriarMovimento>;

/**
 * Campos do Fato Financeiro que um lançamento manual aceita corrigir.
 *
 * `descricaoFonte` não está aqui de propósito: o original nunca é reescrito.
 * Para mudar o texto que aparece na conversa, use `descricao`, que é
 * Conhecimento. Ver ADR-009.
 */
export const schemaCamposFatoManual = z.object({
  valor: z.number().positive().optional(),
  dataMovimento: dataISOSchema.optional(),
  contaId: z.string().uuid().optional(),
  cartaoId: z.string().uuid().optional(),
  status: statusMovimentoSchema.optional(),
  formaPagamento: formaPagamentoSchema.nullable().optional(),
  /** Regenera o parcelamento da compra no cartão com essa quantidade. */
  parcelas: z.number().int().min(1).max(360).optional(),
});
export type CamposFatoManual = z.infer<typeof schemaCamposFatoManual>;

/**
 * Conhecimento do LançAI. Sempre editável, inclusive em conta sincronizada —
 * é justamente o que o produto agrega em cima do extrato bruto.
 */
export const schemaConhecimentoMovimento = z.object({
  descricao: z.string().min(1).optional(),
  categoriaId: z.string().uuid().optional(),
  pessoaId: z.string().uuid().optional(),
  perfil: perfilSchema.optional(),
  tags: z.array(z.string().min(1)).optional(),
  observacoes: z.string().nullable().optional(),
  classificadoPor: classificadoPorSchema.optional(),
  /** Preenchido só quando `classificadoPor = regra`. Null limpa o vínculo. */
  regraId: z.string().uuid().nullable().optional(),
  confiancaIa: z.number().min(0).max(1).nullable().optional(),
  ignoradoEmRelatorio: z.boolean().optional(),
});
export type ConhecimentoMovimento = z.infer<typeof schemaConhecimentoMovimento>;

export const schemaCorrigirFatoManual = z.object({
  movimentoId: z.string().uuid(),
  alteradoPor: z.string().uuid(),
  campos: schemaCamposFatoManual.refine((campos) => Object.keys(campos).length > 0, {
    message: "Informe ao menos um campo para corrigir",
  }),
});
export type EntradaCorrigirFatoManual = z.infer<typeof schemaCorrigirFatoManual>;

export const schemaAtualizarConhecimento = z.object({
  movimentoId: z.string().uuid(),
  alteradoPor: z.string().uuid(),
  conhecimento: schemaConhecimentoMovimento.refine((dados) => Object.keys(dados).length > 0, {
    message: "Informe ao menos um campo de conhecimento para atualizar",
  }),
});
export type EntradaAtualizarConhecimento = z.infer<typeof schemaAtualizarConhecimento>;

/**
 * O que a IA produz ao interpretar "corrige o combustível pra 210 e joga em
 * Transporte": uma correção só, misturando os dois grupos. A separação
 * acontece na fronteira, com `separar_correcao_por_grupo`, e não no prompt —
 * pedir para o modelo respeitar a fronteira seria confiar disciplina a quem
 * não tem como garanti-la.
 */
export const schemaCorrigirMovimento = z.object({
  movimentoId: z.string().uuid(),
  alteradoPor: z.string().uuid(),
  campos: schemaCamposFatoManual
    .merge(schemaConhecimentoMovimento)
    .refine((campos) => Object.keys(campos).length > 0, {
      message: "Informe ao menos um campo para corrigir",
    }),
});
export type EntradaCorrigirMovimento = z.infer<typeof schemaCorrigirMovimento>;

const CHAVES_FATO_MANUAL = Object.keys(schemaCamposFatoManual.shape) as Array<
  keyof CamposFatoManual
>;
const CHAVES_CONHECIMENTO = Object.keys(schemaConhecimentoMovimento.shape) as Array<
  keyof ConhecimentoMovimento
>;

/**
 * Divide uma correção mista nos dois grupos, para que cada metade vá ao
 * componente com autoridade sobre ela. Devolve `undefined` no grupo que não
 * recebeu nenhum campo, permitindo que o chamador chame só o necessário.
 */
export function separar_correcao_por_grupo(entrada: EntradaCorrigirMovimento): {
  fato?: EntradaCorrigirFatoManual;
  conhecimento?: EntradaAtualizarConhecimento;
} {
  const campos = entrada.campos as Record<string, unknown>;

  const camposFato: Record<string, unknown> = {};
  for (const chave of CHAVES_FATO_MANUAL) {
    if (campos[chave] !== undefined) camposFato[chave] = campos[chave];
  }

  const conhecimento: Record<string, unknown> = {};
  for (const chave of CHAVES_CONHECIMENTO) {
    if (campos[chave] !== undefined) conhecimento[chave] = campos[chave];
  }

  return {
    fato:
      Object.keys(camposFato).length > 0
        ? {
            movimentoId: entrada.movimentoId,
            alteradoPor: entrada.alteradoPor,
            campos: camposFato as CamposFatoManual,
          }
        : undefined,
    conhecimento:
      Object.keys(conhecimento).length > 0
        ? {
            movimentoId: entrada.movimentoId,
            alteradoPor: entrada.alteradoPor,
            conhecimento: conhecimento as ConhecimentoMovimento,
          }
        : undefined,
  };
}
