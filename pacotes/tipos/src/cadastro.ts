import { z } from "zod";

export const perfilSchema = z.enum(["pf", "pj"]);
export type Perfil = z.infer<typeof perfilSchema>;

export const modalidadeCartaoSchema = z.enum(["credito", "debito", "multiplo"]);
export type ModalidadeCartao = z.infer<typeof modalidadeCartaoSchema>;

export const formaPagamentoSchema = z.enum([
  "pix",
  "transferencia",
  "boleto",
  "dinheiro",
  "credito",
  "debito",
]);
export type FormaPagamento = z.infer<typeof formaPagamentoSchema>;

export const schemaCriarUsuario = z.object({
  nome: z.string().min(1),
  email: z.string().email(),
});
export type EntradaCriarUsuario = z.infer<typeof schemaCriarUsuario>;

/**
 * Usado pelo apps/web para garantir que exista um `usuario` com o mesmo `id`
 * do usuário autenticado no Supabase Auth — por decisão de arquitetura, o
 * `usuario.id` do Lançai É o `auth.users.id` do Supabase (sem tabela de
 * vínculo extra), simplificando o MVP de autenticação.
 */
export const schemaSincronizarUsuario = z.object({
  id: z.string().uuid(),
  nome: z.string().min(1),
  email: z.string().email(),
});
export type EntradaSincronizarUsuario = z.infer<typeof schemaSincronizarUsuario>;

export const schemaCriarConta = z.object({
  nome: z.string().min(1),
  saldoInicial: z.number().default(0),
  perfil: perfilSchema,
  usuarioId: z.string().uuid(),
});
export type EntradaCriarConta = z.infer<typeof schemaCriarConta>;

export const schemaCriarCartao = z.object({
  nome: z.string().min(1),
  limite: z.number().nonnegative(),
  fechamento: z.number().int().min(1).max(31),
  vencimento: z.number().int().min(1).max(31),
  perfil: perfilSchema,
  /**
   * Default aplicado no repositório: credito sem conta, multiplo com conta.
   * debito exige contaId.
   */
  modalidade: modalidadeCartaoSchema.optional(),
  /** Conta vinculada (débito / fatura preferencial) — opcional no crédito puro. */
  contaId: z.string().uuid().optional(),
  usuarioId: z.string().uuid(),
  /** Últimos 4 dígitos (em claro) quando o usuário informou o número do plástico. */
  final4: z.string().length(4).optional(),
  /** Payload AES-GCM com número/validade/CVV — nunca expor em listagens. */
  dadosPlasticosCifrados: z.string().min(1).optional(),
});
export type EntradaCriarCartao = z.infer<typeof schemaCriarCartao>;

/** Usado por CORRIGIR_CONTA — todo campo é opcional pois só os citados pelo usuário devem mudar. */
export const schemaAtualizarConta = z.object({
  nome: z.string().min(1).optional(),
  saldoAtual: z.number().optional(),
  perfil: perfilSchema.optional(),
  ativo: z.boolean().optional(),
});
export type EntradaAtualizarConta = z.infer<typeof schemaAtualizarConta>;

/** Usado por CORRIGIR_CARTAO — todo campo é opcional pois só os citados pelo usuário devem mudar. */
export const schemaAtualizarCartao = z.object({
  nome: z.string().min(1).optional(),
  limite: z.number().nonnegative().optional(),
  fechamento: z.number().int().min(1).max(31).optional(),
  vencimento: z.number().int().min(1).max(31).optional(),
  perfil: perfilSchema.optional(),
  modalidade: modalidadeCartaoSchema.optional(),
  contaId: z.string().uuid().nullable().optional(),
  ativo: z.boolean().optional(),
  final4: z.string().length(4).optional(),
  dadosPlasticosCifrados: z.string().min(1).optional(),
});
export type EntradaAtualizarCartao = z.infer<typeof schemaAtualizarCartao>;

export const schemaCriarCategoria = z.object({
  nome: z.string().min(1),
  tipo: z.enum(["receita", "despesa", "ambos"]),
  usuarioId: z.string().uuid(),
});
export type EntradaCriarCategoria = z.infer<typeof schemaCriarCategoria>;

export const schemaCriarPessoa = z.object({
  nome: z.string().min(1),
  tipo: z.enum(["cliente", "fornecedor", "socio", "funcionario", "familiar"]),
  usuarioId: z.string().uuid(),
});
export type EntradaCriarPessoa = z.infer<typeof schemaCriarPessoa>;
