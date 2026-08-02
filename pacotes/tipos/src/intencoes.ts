import { z } from "zod";
import { perfilSchema } from "./cadastro";
import { tipoMovimentoSchema } from "./movimento";

const dataISOSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato YYYY-MM-DD");

/**
 * Alguns modelos de IA (observado no gemini-3.6-flash em modo "thinking") ocasionalmente
 * degeneram a geração de um número pequeno numa versão gigante do mesmo dígito seguida só
 * de zeros (ex.: 27 vira 2.7e+17 ou 27000000000000000). O padrão é inconfundível — mesmos
 * dígitos líderes, resto só zeros — então é seguro recuperar o valor original dividindo
 * por 10 até caber no intervalo esperado, em vez de derrubar a intenção inteira por causa
 * de um único campo corrompido.
 */
function normalizarNumeroDegenerado(valor: unknown, max: number): unknown {
  if (typeof valor !== "number" || !Number.isFinite(valor) || valor <= max) return valor;
  let normalizado = valor;
  while (Number.isInteger(normalizado) && normalizado > max && normalizado % 10 === 0) {
    normalizado /= 10;
  }
  return normalizado;
}

/** Dia do mês (1-31) com recuperação automática de números degenerados. */
const diaDoMesSchema = z.preprocess(
  (valor) => normalizarNumeroDegenerado(valor, 31),
  z.number().int().min(1).max(31),
);

/**
 * Contrato de saída do `InterpretadorIntencoes` para lançamentos.
 * Diferente de `EntradaCriarMovimento` (pacotes/tipos/movimento.ts), aqui as
 * referências ainda são nomes em texto livre (`conta_nome`, `categoria_nome`...) —
 * a resolução para IDs reais acontece no `ResolvedorIntencao` (modulos/ia),
 * nunca dentro da própria IA (ADR-003).
 */
export const schemaIntencaoRegistrarMovimento = z.object({
  intencao: z.literal("REGISTRAR_MOVIMENTO"),
  tipo_movimento: tipoMovimentoSchema,
  /**
   * Opcional na saída bruta da IA: mensagens vagas ("fiz mercado") podem vir sem valor.
   * O `normalizar_intencao` em `@lancai/ia` completa defaults ou converte para
   * SOLICITAR_INFORMACAO antes de chegar no motor.
   */
  valor: z.number().positive().nullable().optional(),
  data_movimento: dataISOSchema.nullable().optional(),
  descricao: z.string().min(1),
  perfil: perfilSchema.nullable().optional(),
  conta_nome: z.string().min(1).nullable().optional(),
  cartao_nome: z.string().min(1).nullable().optional(),
  conta_destino_nome: z.string().min(1).nullable().optional(),
  categoria_nome: z.string().min(1).nullable().optional(),
  pessoa_nome: z.string().min(1).nullable().optional(),
  parcelas: z.number().int().min(2).max(360).nullable().optional(),
});
export type IntencaoRegistrarMovimento = z.infer<typeof schemaIntencaoRegistrarMovimento>;

export const tipoVisaoSchema = z.enum([
  "saldos",
  "cartoes",
  "parcelamentos",
  "categoria",
  "futuro",
  "fluxo",
  "evolucao",
  "historico",
]);
export type TipoVisao = z.infer<typeof tipoVisaoSchema>;

export const schemaFiltrosVisao = z.object({
  categoria_nome: z.string().min(1).nullable().optional(),
  conta_nome: z.string().min(1).nullable().optional(),
  cartao_nome: z.string().min(1).nullable().optional(),
  pessoa_nome: z.string().min(1).nullable().optional(),
  perfil: perfilSchema.nullable().optional(),
  periodo: z
    .object({ de: dataISOSchema, ate: dataISOSchema })
    .nullable()
    .optional(),
});
export type FiltrosVisao = z.infer<typeof schemaFiltrosVisao>;

export const schemaIntencaoConsultarVisao = z.object({
  intencao: z.literal("CONSULTAR_VISAO"),
  tipo_visao: tipoVisaoSchema,
  filtros: schemaFiltrosVisao,
});
export type IntencaoConsultarVisao = z.infer<typeof schemaIntencaoConsultarVisao>;

export const schemaIntencaoCorrigirMovimento = z.object({
  intencao: z.literal("CORRIGIR_MOVIMENTO"),
  referencia: z.object({
    descricao: z.string().min(1).nullable().optional(),
    data_movimento: dataISOSchema.nullable().optional(),
  }),
  campos_alterados: z.object({
    valor: z.number().positive().nullable().optional(),
    descricao: z.string().min(1).nullable().optional(),
    data_movimento: dataISOSchema.nullable().optional(),
    categoria_nome: z.string().min(1).nullable().optional(),
    conta_nome: z.string().min(1).nullable().optional(),
    cartao_nome: z.string().min(1).nullable().optional(),
    pessoa_nome: z.string().min(1).nullable().optional(),
    perfil: perfilSchema.nullable().optional(),
    /** Novo número de parcelas (só compras no cartão). Regenera as parcelas restantes. */
    parcelas: z.number().int().min(1).max(360).nullable().optional(),
    /** Use "cancelado" para apagar logicamente o lançamento. */
    status: z.enum(["previsto", "realizado", "cancelado"]).nullable().optional(),
  }),
});
export type IntencaoCorrigirMovimento = z.infer<typeof schemaIntencaoCorrigirMovimento>;

/**
 * Escape hatch para mensagens que não são um lançamento, consulta ou correção
 * (ex.: saudações, perguntas fora do domínio financeiro). Não está no documento
 * original, mas é necessário para o `InterpretadorIntencoes` nunca ser forçado
 * a inventar uma das outras três intenções quando a mensagem não se encaixa.
 */
export const schemaIntencaoNaoReconhecida = z.object({
  intencao: z.literal("NAO_RECONHECIDA"),
  motivo: z.string(),
});
export type IntencaoNaoReconhecida = z.infer<typeof schemaIntencaoNaoReconhecida>;

/**
 * Onboarding/cadastro incremental de conta via conversa. Campos opcionais
 * porque um turno pode trazer só parte dos dados (slot-filling flexível) —
 * quando algo obrigatório falta, o `InterpretadorIntencoes` deve preferir
 * `SOLICITAR_INFORMACAO` em vez de inventar um valor.
 */
export const schemaIntencaoCriarConta = z.object({
  intencao: z.literal("CRIAR_CONTA"),
  nome: z.string().min(1).nullable().optional(),
  saldo_inicial: z.number().nullable().optional(),
  perfil: perfilSchema.nullable().optional(),
});
export type IntencaoCriarConta = z.infer<typeof schemaIntencaoCriarConta>;

/** Onboarding/cadastro incremental de cartão via conversa (mesma lógica de campos opcionais). */
export const schemaIntencaoCriarCartao = z.object({
  intencao: z.literal("CRIAR_CARTAO"),
  nome: z.string().min(1).nullable().optional(),
  limite: z.number().nullable().optional(),
  fechamento: diaDoMesSchema.nullable().optional(),
  vencimento: diaDoMesSchema.nullable().optional(),
  perfil: perfilSchema.nullable().optional(),
  conta_nome: z.string().min(1).nullable().optional(),
});
export type IntencaoCriarCartao = z.infer<typeof schemaIntencaoCriarCartao>;

/**
 * Corrige uma conta JÁ EXISTENTE (ex.: "muda o saldo da conta Mercado Pago pra 5000",
 * "renomeia minha conta Caixa pra Carteira"). Diferente de CRIAR_CONTA — que sempre cria um
 * registro novo — aqui a conta precisa existir; a intenção correta é o que evita que um pedido
 * de correção de saldo seja mal interpretado como um novo cadastro e duplique a conta.
 */
export const schemaIntencaoCorrigirConta = z.object({
  intencao: z.literal("CORRIGIR_CONTA"),
  conta_nome: z.string().min(1),
  campos_alterados: z.object({
    nome: z.string().min(1).nullable().optional(),
    saldo_atual: z.number().nullable().optional(),
    perfil: perfilSchema.nullable().optional(),
    /**
     * Exclusão lógica (append-only): `false` = remover/apagar/excluir a conta.
     * O registro permanece no banco com `ativo = false` e some das listagens.
     */
    ativo: z.boolean().nullable().optional(),
    /**
     * Só é `true` depois que o usuário confirmou a exclusão (respondeu "sim" à
     * pergunta do sistema). Sem isso, o backend só pergunta se deseja excluir.
     */
    confirmado: z.boolean().nullable().optional(),
  }),
});
export type IntencaoCorrigirConta = z.infer<typeof schemaIntencaoCorrigirConta>;

/** Mesma lógica de `schemaIntencaoCorrigirConta`, mas para cartão. */
export const schemaIntencaoCorrigirCartao = z.object({
  intencao: z.literal("CORRIGIR_CARTAO"),
  cartao_nome: z.string().min(1),
  campos_alterados: z.object({
    nome: z.string().min(1).nullable().optional(),
    limite: z.number().nullable().optional(),
    fechamento: diaDoMesSchema.nullable().optional(),
    vencimento: diaDoMesSchema.nullable().optional(),
    perfil: perfilSchema.nullable().optional(),
    /** Conta que passa a pagar a fatura desse cartão. */
    conta_nome: z.string().min(1).nullable().optional(),
    /** Exclusão lógica: `false` = remover/apagar/excluir o cartão. */
    ativo: z.boolean().nullable().optional(),
    /** `true` só após o usuário confirmar a exclusão. */
    confirmado: z.boolean().nullable().optional(),
  }),
});
export type IntencaoCorrigirCartao = z.infer<typeof schemaIntencaoCorrigirCartao>;

/**
 * Usada quando a IA já identificou qual intenção o usuário quer (ex.:
 * cadastrar uma conta), mas falta pelo menos um dado obrigatório para
 * completá-la. Em vez de inventar valores, o `InterpretadorIntencoes` devolve
 * essa intenção com a pergunta certa; o sistema a repassa ao usuário e, no
 * próximo turno, o histórico recente da conversa (não um estado persistido)
 * dá à IA o contexto necessário para juntar a resposta à intenção pendente.
 */
export const schemaIntencaoSolicitarInformacao = z.object({
  intencao: z.literal("SOLICITAR_INFORMACAO"),
  intencao_pendente: z.enum(["CRIAR_CONTA", "CRIAR_CARTAO", "REGISTRAR_MOVIMENTO"]),
  pergunta: z.string().min(1),
  dados_parciais: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type IntencaoSolicitarInformacao = z.infer<typeof schemaIntencaoSolicitarInformacao>;

/**
 * Nunca é gerada pela IA — usada exclusivamente pelo atalho determinístico de
 * "menu"/"ajuda" em `apps/api/src/rotas/chat.ts`, que intercepta a mensagem
 * antes de chamar o `InterpretadorIntencoes` (resposta fixa, sem custo de IA
 * e sem depender de nenhum provedor estar disponível).
 */
export const schemaIntencaoMenu = z.object({
  intencao: z.literal("MENU"),
});
export type IntencaoMenu = z.infer<typeof schemaIntencaoMenu>;

export const schemaIntencaoDetectada = z.discriminatedUnion("intencao", [
  schemaIntencaoRegistrarMovimento,
  schemaIntencaoConsultarVisao,
  schemaIntencaoCorrigirMovimento,
  schemaIntencaoCriarConta,
  schemaIntencaoCriarCartao,
  schemaIntencaoCorrigirConta,
  schemaIntencaoCorrigirCartao,
  schemaIntencaoSolicitarInformacao,
  schemaIntencaoMenu,
  schemaIntencaoNaoReconhecida,
]);
export type IntencaoDetectada = z.infer<typeof schemaIntencaoDetectada>;
