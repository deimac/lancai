import { z } from "zod";

/**
 * Origem de uma movimentação. `ofx`, `csv` e `pdf` estão reservados e ainda
 * não têm implementação — existem aqui para que adicioná-los depois não
 * exija migração de enum.
 */
export const tipoFonteSchema = z.enum([
  "open_finance",
  "manual",
  "whatsapp",
  "api",
  "recorrencia",
  "ofx",
  "csv",
  "pdf",
]);
export type TipoFonte = z.infer<typeof tipoFonteSchema>;

/**
 * Situação da transação na instituição. Não confundir com `StatusMovimento`.
 *
 * `removido` é o que a instituição afirma ao desfazer a transação — estorno de
 * compra, duplicata que o banco corrigiu, agendamento cancelado. Continua sendo
 * Fato: o que mudou é a afirmação da instituição, não a nossa leitura dela.
 */
export const statusFonteSchema = z.enum(["confirmado", "pendente", "removido"]);
export type StatusFonte = z.infer<typeof statusFonteSchema>;

export const classificadoPorSchema = z.enum(["regra", "ia", "usuario"]);
export type ClassificadoPor = z.infer<typeof classificadoPorSchema>;

const dataISOSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato YYYY-MM-DD");

/**
 * O que a instituição afirma sobre o parcelamento de uma compra no cartão.
 *
 * Cada parcela chega como transação independente, e é assim que ela é gravada:
 * um Fato por parcela. Reconstruir a compra-mãe a partir das parcelas seria
 * adivinhação, e adivinhação não produz Fato — agrupar é trabalho do
 * Conhecimento, e o que está aqui é a matéria-prima para ele.
 */
export const parcelamentoFonteSchema = z.object({
  numero: z.number().int().positive(),
  total: z.number().int().positive(),
  /**
   * Valor da compra inteira. Guardado em vez de calculado porque parcela
   * desigual existe: 3x de R$ 33,34 + R$ 33,33 + R$ 33,33 não multiplica.
   */
  valorTotal: z.number().positive().optional(),
  /** Data da compra original, que é anterior à data desta parcela. */
  compraEm: dataISOSchema.optional(),
});
export type ParcelamentoFonte = z.infer<typeof parcelamentoFonteSchema>;

/**
 * O que qualquer Fonte Financeira entrega ao Core. Contém apenas Fato — não há
 * campo de categoria, tag ou perfil aqui, porque nenhuma fonte tem autoridade
 * sobre o Conhecimento do LançAI.
 */
export const schemaEventoFinanceiroNormalizado = z.object({
  workspaceId: z.string().uuid(),
  fonte: tipoFonteSchema,
  /** Rótulo opaco ("pluggy"). O Core armazena e nunca interpreta. */
  provedor: z.string().optional(),
  /** Identificador na instituição ou hash do arquivo importado. Chave de deduplicação. */
  idExterno: z.string().nullable(),
  ocorridoEm: dataISOSchema,
  /**
   * Instante ISO da instituição, quando ela informa hora. Ausente se só veio o dia
   * ou se a competência do movimento não é o `date` original (parcela/fatura).
   */
  ocorridoEmInstante: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/)
    .optional(),
  valor: z.number().positive(),
  /**
   * Só entrada ou saída. Uma linha de extrato é dinheiro entrando ou saindo de
   * uma conta; dizer que duas linhas formam uma transferência é interpretação,
   * e interpretação é Conhecimento, não Fato.
   */
  tipo: z.enum(["receita", "despesa"]),
  descricaoFonte: z.string().min(1),
  favorecidoFonte: z.string().optional(),
  contaId: z.string().uuid().optional(),
  cartaoId: z.string().uuid().optional(),
  statusFonte: statusFonteSchema.default("confirmado"),
  /** Ausente na esmagadora maioria: só compra parcelada no cartão traz. */
  parcelamento: parcelamentoFonteSchema.optional(),
  /**
   * Declarado pela fonte, não pelo Core. É isso que permite acrescentar uma
   * fonte nova sem tocar em nenhuma linha do Core. Ver ADR-010.
   */
  fatoImutavel: z.boolean(),
});
export type EventoFinanceiroNormalizado = z.infer<typeof schemaEventoFinanceiroNormalizado>;

/**
 * Duas razões independentes tornam o Fato de uma movimentação intocável à mão:
 * ela nasceu na instituição, ou a conta onde ela vive passou a ser sincronizada
 * depois — caso dos lançamentos manuais anteriores à conexão do banco.
 *
 * Mora aqui, e não no Core, porque quem decide o que mostrar ao usuário precisa
 * saber a resposta antes de tentar a operação. Sem isso, a conversa pergunta
 * "tem certeza que quer excluir?" para em seguida recusar.
 */
export function fato_protegido(
  movimento: { fonte: TipoFonte },
  origem?: { sincronizada: boolean } | null,
): boolean {
  return movimento.fonte === "open_finance" || origem?.sincronizada === true;
}

/**
 * Porta única de entrada de movimentações (ADR-010). Open Finance é uma
 * implementação disto, não um caso especial no Core.
 */
export interface FonteFinanceira {
  readonly id: string;
  readonly tipo: TipoFonte;
  coletar(workspaceId: string): Promise<EventoFinanceiroNormalizado[]>;
}
