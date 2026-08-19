import { z } from "zod";

export const perfilSchema = z.enum(["pf", "pj"]);
export type Perfil = z.infer<typeof perfilSchema>;

export const papelConhecimentoSchema = z.enum(["gasto", "pagamento_fatura"]);
export type PapelConhecimento = z.infer<typeof papelConhecimentoSchema>;

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

export const posicaoPainelSchema = z.enum(["lateral", "inferior"]);
export type PosicaoPainel = z.infer<typeof posicaoPainelSchema>;

/** Atualização parcial do perfil (Configurações). `whatsappNumero: null` desvincula. */
export const schemaAtualizarUsuario = z.object({
  nome: z.string().min(1).optional(),
  whatsappNumero: z
    .union([
      z
        .string()
        .regex(/^\d{10,15}$/, "Informe o WhatsApp só com dígitos (10 a 15)."),
      z.null(),
    ])
    .optional(),
  posicaoPainel: posicaoPainelSchema.optional(),
});
export type EntradaAtualizarUsuario = z.infer<typeof schemaAtualizarUsuario>;

export const schemaCriarConta = z.object({
  nome: z.string().min(1),
  saldoInicial: z.number().default(0),
  perfil: perfilSchema,
  usuarioId: z.string().uuid(),
});
export type EntradaCriarConta = z.infer<typeof schemaCriarConta>;

/** PATCH /contas/:id — body da API web. */
export const schemaPatchContaApi = z.object({
  usuarioId: z.string().uuid(),
  nome: z.string().min(1).optional(),
  saldoAtual: z.number().optional(),
  perfil: perfilSchema.optional(),
});
export type EntradaPatchContaApi = z.infer<typeof schemaPatchContaApi>;

export const schemaExcluirContaApi = z.object({
  usuarioId: z.string().uuid(),
});

/** Dados do plástico em claro — a API cifra antes de persistir. */
export const schemaPlasticoCartao = z.object({
  numero: z.string().min(1),
  validade: z.string().min(1),
  cvv: z.string().min(1),
});
export type EntradaPlasticoCartao = z.infer<typeof schemaPlasticoCartao>;

/** PATCH /cartoes/:id — body da API web. */
export const schemaPatchCartaoApi = z.object({
  usuarioId: z.string().uuid(),
  nome: z.string().min(1).optional(),
  limite: z.number().nonnegative().optional(),
  /** Saldo devido do cartão. */
  saldo: z.number().nonnegative().optional(),
  fechamento: z.number().int().min(1).max(31).optional(),
  vencimento: z.number().int().min(1).max(31).optional(),
  perfil: perfilSchema.optional(),
  contaId: z.string().uuid().nullable().optional(),
  plastico: schemaPlasticoCartao.optional(),
});
export type EntradaPatchCartaoApi = z.infer<typeof schemaPatchCartaoApi>;

export const schemaExcluirCartaoApi = z.object({
  usuarioId: z.string().uuid(),
});

/** POST /cartoes/:id/revelar — senha da conta para ver número/validade/CVV. */
export const schemaRevelarPlasticoApi = z.object({
  usuarioId: z.string().uuid(),
  senha: z.string().min(1),
});
export type EntradaRevelarPlasticoApi = z.infer<typeof schemaRevelarPlasticoApi>;

const corWorkspaceSchema = z.enum([
  "violet",
  "blue",
  "teal",
  "orange",
  "red",
  "pink",
  "indigo",
  "slate",
]);

export const schemaCriarWorkspace = z.object({
  usuarioId: z.string().uuid(),
  nome: z.string().min(1),
  descricao: z.string().max(500).optional().nullable(),
  cor: corWorkspaceSchema.optional(),
});

export const schemaDefinirWorkspaceAtivo = z.object({
  usuarioId: z.string().uuid(),
  /** UUID real ou literal `geral` (visão agregada). */
  workspaceId: z.union([z.literal("geral"), z.string().uuid()]),
});

export const schemaAtualizarWorkspace = z.object({
  usuarioId: z.string().uuid(),
  nome: z.string().min(1).optional(),
  descricao: z.string().max(500).optional().nullable(),
  cor: corWorkspaceSchema.optional(),
});

export const schemaMembrosWorkspace = z.object({
  usuarioId: z.string().uuid(),
  contaIds: z.array(z.string().uuid()),
  cartaoIds: z.array(z.string().uuid()),
});

export const schemaExcluirWorkspaceApi = z.object({
  usuarioId: z.string().uuid(),
});

export const schemaCriarCartao = z.object({
  nome: z.string().min(1),
  limite: z.number().nonnegative(),
  /** Saldo devido do cartão (gasto/dívida atual). */
  saldo: z.number().nonnegative().optional(),
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
  /** Número / validade / CVV em claro — a API cifra; máscara vem na leitura. */
  plastico: schemaPlasticoCartao.optional(),
  /** Payload AES-GCM com número/validade/CVV — compatível com chat. */
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
  saldo: z.number().nonnegative().optional(),
  fechamento: z.number().int().min(1).max(31).optional(),
  vencimento: z.number().int().min(1).max(31).optional(),
  perfil: perfilSchema.optional(),
  modalidade: modalidadeCartaoSchema.optional(),
  contaId: z.string().uuid().nullable().optional(),
  ativo: z.boolean().optional(),
  plastico: schemaPlasticoCartao.optional(),
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
