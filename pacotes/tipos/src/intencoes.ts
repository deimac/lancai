import { z } from "zod";
import { formaPagamentoSchema, modalidadeCartaoSchema, perfilSchema } from "./cadastro";
import { tipoMovimentoSchema } from "./movimento";

const dataISOSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato YYYY-MM-DD");

/**
 * Número/validade/CVV às vezes vêm como number da LLM (ex.: cvv: 443).
 * Converte para string antes da validação para não derrubar a intenção inteira.
 */
const textoPlasticoSchema = z.preprocess((valor) => {
  if (valor == null) return valor;
  if (typeof valor === "number" && Number.isFinite(valor)) return String(Math.trunc(valor));
  if (typeof valor === "string") {
    const texto = valor.trim();
    return texto.length > 0 ? texto : null;
  }
  return valor;
}, z.string().min(1).nullable().optional());

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
  /**
   * Meio de pagamento. Em cartão, omitir = crédito. Em conta, omitir = pix
   * (nunca null). Inferir de "pix", "boleto", "no débito", etc. quando explícito.
   */
  forma_pagamento: formaPagamentoSchema.nullable().optional(),
  /**
   * `true` só depois que o usuário confirmou registrar mesmo com lançamento
   * igual já existente (mesmo valor, data, descrição e conta/cartão).
   * Sem isso, o backend pergunta se deseja registrar de novo.
   */
  confirmado: z.boolean().nullable().optional(),
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
  /** Termo de descrição/estabelecimento (ex.: "Uber", "farmácia") — não é categoria. */
  descricao: z.string().min(1).nullable().optional(),
  conta_nome: z.string().min(1).nullable().optional(),
  cartao_nome: z.string().min(1).nullable().optional(),
  pessoa_nome: z.string().min(1).nullable().optional(),
  perfil: perfilSchema.nullable().optional(),
  periodo: z
    .object({ de: dataISOSchema, ate: dataISOSchema })
    .nullable()
    .optional(),
  /**
   * Lado do fluxo: "gastei/despesa" → `["despesa"]`; "recebi/entrou" → `["receita"]`.
   * Omitido = extrato completo (receitas e despesas).
   */
  tipos: z.array(tipoMovimentoSchema).min(1).nullable().optional(),
});
export type FiltrosVisao = z.infer<typeof schemaFiltrosVisao>;

export const schemaIntencaoConsultarVisao = z.object({
  intencao: z.literal("CONSULTAR_VISAO"),
  tipo_visao: tipoVisaoSchema,
  filtros: schemaFiltrosVisao,
  /**
   * Histórico: `true` lista lançamentos; `false` só totais (perguntas "quanto gastei…").
   * Omitido = a API decide pela mensagem.
   */
  detalhado: z.boolean().nullable().optional(),
  /**
   * Histórico detalhado: quantos lançamentos pular (paginação via “mais”).
   * Preenchido pelo atalho determinístico; a LLM não deve inventar.
   */
  deslocamento: z.number().int().min(0).nullable().optional(),
});
export type IntencaoConsultarVisao = z.infer<typeof schemaIntencaoConsultarVisao>;

export const schemaIntencaoCorrigirMovimento = z.object({
  intencao: z.literal("CORRIGIR_MOVIMENTO"),
  referencia: z.object({
    descricao: z.string().min(1).nullable().optional(),
    data_movimento: dataISOSchema.nullable().optional(),
    /** Código curto do lançamento (ex.: "a1b2c3d4" ou "#a1b2c3d4"). */
    codigo: z.string().min(4).max(36).nullable().optional(),
    /**
     * Posição 1-based na lista de semelhantes (desambiguação por número).
     * Preenchido pelo atalho "1"/"2" após "Encontrei N lançamentos semelhantes…".
     */
    indice: z.number().int().positive().nullable().optional(),
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
    forma_pagamento: formaPagamentoSchema.nullable().optional(),
    /**
     * Só é `true` depois que o usuário confirmou o cancelamento (respondeu "sim").
     * Sem isso, o backend só pergunta se deseja excluir o lançamento.
     */
    confirmado: z.boolean().nullable().optional(),
    /** Conhecimento: some das agregações sem apagar o Fato (conta sincronizada). */
    ignorado_em_relatorio: z.boolean().nullable().optional(),
    /** Conhecimento: marcações livres (ex.: projeto Itália). */
    tags: z.array(z.string().min(1)).nullable().optional(),
    /** Conhecimento: nota livre; `null` limpa. */
    observacoes: z.string().nullable().optional(),
  }),
});
export type IntencaoCorrigirMovimento = z.infer<typeof schemaIntencaoCorrigirMovimento>;

/**
 * Escape hatch para mensagens fora do domínio financeiro (saudações, perguntas
 * genéricas). A IA pode gerá-la; cancelamentos amigáveis e orientação de fluxo
 * usam `MENSAGEM_INFO`, não esta intenção.
 */
export const schemaIntencaoNaoReconhecida = z.object({
  intencao: z.literal("NAO_RECONHECIDA"),
  motivo: z.string(),
});
export type IntencaoNaoReconhecida = z.infer<typeof schemaIntencaoNaoReconhecida>;

/**
 * Resposta informativa sem efeito no Core: usuário abortou uma confirmação
 * (“Exclusão cancelada”), ou o atalho precisa orientar o fluxo (“número inválido”).
 * Nunca gerada pela LLM — só pelos atalhos de confirmação.
 */
export const schemaIntencaoMensagemInfo = z.object({
  intencao: z.literal("MENSAGEM_INFO"),
  motivo: z.string(),
});
export type IntencaoMensagemInfo = z.infer<typeof schemaIntencaoMensagemInfo>;

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
  /**
   * Opcional: o normalizador define credito (sem conta), multiplo (com conta)
   * ou debito (só se o usuário disser "cartão de débito").
   */
  modalidade: modalidadeCartaoSchema.nullable().optional(),
  conta_nome: z.string().min(1).nullable().optional(),
  /** Número do plástico (opcional no cadastro). */
  numero: textoPlasticoSchema,
  /** Validade do plástico no formato MM/AA. */
  validade: textoPlasticoSchema,
  /** CVV do plástico. */
  cvv: textoPlasticoSchema,
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
    modalidade: modalidadeCartaoSchema.nullable().optional(),
    /** Conta vinculada (débito / preferencial da fatura). */
    conta_nome: z.string().min(1).nullable().optional(),
    /** Exclusão lógica: `false` = remover/apagar/excluir o cartão. */
    ativo: z.boolean().nullable().optional(),
    /** `true` só após o usuário confirmar a exclusão. */
    confirmado: z.boolean().nullable().optional(),
    numero: textoPlasticoSchema,
    validade: textoPlasticoSchema,
    cvv: textoPlasticoSchema,
  }),
});
export type IntencaoCorrigirCartao = z.infer<typeof schemaIntencaoCorrigirCartao>;

/**
 * Pedido para ver número/validade/CVV de um cartão. O sistema NÃO revela os
 * dados neste turno — só pede a senha da conta LançAI; a revelação acontece
 * no atalho determinístico após a senha ser validada.
 */
export const schemaIntencaoConsultarDadosCartao = z.object({
  intencao: z.literal("CONSULTAR_DADOS_CARTAO"),
  cartao_nome: z.string().min(1),
});
export type IntencaoConsultarDadosCartao = z.infer<typeof schemaIntencaoConsultarDadosCartao>;

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
  intencao_pendente: z.enum([
    "CRIAR_CONTA",
    "CRIAR_CARTAO",
    "REGISTRAR_MOVIMENTO",
    "CRIAR_RECORRENCIA",
  ]),
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

/** Define limite de gasto mensal (geral ou por categoria). */
export const schemaIntencaoDefinirOrcamento = z.object({
  intencao: z.literal("DEFINIR_ORCAMENTO"),
  valor_limite: z.number().positive(),
  categoria_nome: z.string().min(1).nullable().optional(),
});
export type IntencaoDefinirOrcamento = z.infer<typeof schemaIntencaoDefinirOrcamento>;

/** Consulta status do(s) orçamento(s). */
export const schemaIntencaoConsultarOrcamento = z.object({
  intencao: z.literal("CONSULTAR_ORCAMENTO"),
  categoria_nome: z.string().min(1).nullable().optional(),
});
export type IntencaoConsultarOrcamento = z.infer<typeof schemaIntencaoConsultarOrcamento>;

/** Cria despesa/receita recorrente mensal. */
export const schemaIntencaoCriarRecorrencia = z.object({
  intencao: z.literal("CRIAR_RECORRENCIA"),
  descricao: z.string().min(1),
  /**
   * Opcional na saída bruta: "todo mês dia 10 Netflix no Nubank" pode vir sem valor.
   * O normalizador converte para SOLICITAR_INFORMACAO antes de criar.
   */
  valor: z.number().positive().nullable().optional(),
  dia_do_mes: diaDoMesSchema.nullable().optional(),
  tipo_movimento: tipoMovimentoSchema.nullable().optional(),
  categoria_nome: z.string().min(1).nullable().optional(),
  conta_nome: z.string().min(1).nullable().optional(),
  cartao_nome: z.string().min(1).nullable().optional(),
});
export type IntencaoCriarRecorrencia = z.infer<typeof schemaIntencaoCriarRecorrencia>;

export const schemaIntencaoListarRecorrencias = z.object({
  intencao: z.literal("LISTAR_RECORRENCIAS"),
});
export type IntencaoListarRecorrencias = z.infer<typeof schemaIntencaoListarRecorrencias>;

export const schemaIntencaoCancelarRecorrencia = z.object({
  intencao: z.literal("CANCELAR_RECORRENCIA"),
  descricao: z.string().min(1),
});
export type IntencaoCancelarRecorrencia = z.infer<typeof schemaIntencaoCancelarRecorrencia>;

/**
 * Confirmação do “virar regra?” após classificação manual (J9).
 * Emitida só pelo atalho de confirmação — não faz parte do prompt da LLM.
 */
export const schemaIntencaoCriarRegraAprendizado = z.object({
  intencao: z.literal("CRIAR_REGRA_APRENDIZADO"),
  confirmado: z.boolean(),
  /** Mesma referência do CORRIGIR_MOVIMENTO que gerou a oferta. */
  referencia: z
    .object({
      descricao: z.string().min(1).nullable().optional(),
      data_movimento: dataISOSchema.nullable().optional(),
      codigo: z.string().min(1).nullable().optional(),
      indice: z.number().int().positive().nullable().optional(),
    })
    .optional(),
});
export type IntencaoCriarRegraAprendizado = z.infer<typeof schemaIntencaoCriarRegraAprendizado>;

export const schemaIntencaoDetectada = z.discriminatedUnion("intencao", [
  schemaIntencaoRegistrarMovimento,
  schemaIntencaoConsultarVisao,
  schemaIntencaoCorrigirMovimento,
  schemaIntencaoCriarConta,
  schemaIntencaoCriarCartao,
  schemaIntencaoCorrigirConta,
  schemaIntencaoCorrigirCartao,
  schemaIntencaoConsultarDadosCartao,
  schemaIntencaoDefinirOrcamento,
  schemaIntencaoConsultarOrcamento,
  schemaIntencaoCriarRecorrencia,
  schemaIntencaoListarRecorrencias,
  schemaIntencaoCancelarRecorrencia,
  schemaIntencaoCriarRegraAprendizado,
  schemaIntencaoSolicitarInformacao,
  schemaIntencaoMenu,
  schemaIntencaoMensagemInfo,
  schemaIntencaoNaoReconhecida,
]);
export type IntencaoDetectada = z.infer<typeof schemaIntencaoDetectada>;
