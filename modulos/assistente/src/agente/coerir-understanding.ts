import {
  ConversationUnderstandingSchema,
  type ConversationContext,
  type ConversationUnderstanding,
  type PeriodSpec,
  type UnderstandingEntities,
  type UnderstandingIntent,
} from "@lancai/tipos";
import { eh_followup_periodo, periodo_relativo_da_mensagem, parece_continuacao_consulta } from "@lancai/ia";

const GOALS_SEM_CONSULTA = new Set(["execute", "greet", "confirm", "clarify"]);

const INTENTS_NOVA_ANALISE = new Set<UnderstandingIntent>([
  "compare",
  "explain",
  "trend",
  "top",
  "breakdown",
  "projection",
  "create",
  "update",
  "delete",
]);

function chaveNome(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function ehRotuloPerfil(nome: string | undefined): boolean {
  if (!nome) return false;
  return /^(empresa|pessoal|pj|pf|conta da empresa|conta pessoal|conta pj|conta pf)$/.test(
    chaveNome(nome),
  );
}

function temAlvoNovo(entities: UnderstandingEntities | undefined): boolean {
  if (!entities) return false;
  const conta = ehRotuloPerfil(entities.account) ? undefined : entities.account;
  const cartao = ehRotuloPerfil(entities.card) ? undefined : entities.card;
  return Boolean(entities.merchant || entities.category || conta || cartao || entities.amount);
}

function soComplementoOrigem(entities: UnderstandingEntities | undefined): boolean {
  if (!entities) return false;
  if (entities.merchant || entities.category || entities.amount) return false;
  const conta = ehRotuloPerfil(entities.account) ? undefined : entities.account;
  const cartao = ehRotuloPerfil(entities.card) ? undefined : entities.card;
  return Boolean(conta || cartao);
}

function periodosIguais(a?: PeriodSpec, b?: PeriodSpec): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.tipo === b.tipo && a.de === b.de && a.ate === b.ate && a.nMeses === b.nMeses;
}

function relativeDePeriodo(period: PeriodSpec): string {
  if (period.tipo === "mes_passado") return "last_month";
  if (period.tipo === "mes_atual") return "this_month";
  if (period.de) return period.de;
  return period.tipo;
}

function lastFoiTotal(context: ConversationContext): boolean {
  const last = context.last_query;
  if (!last) return false;
  return (
    last.information_need.expected_output === "single_value" ||
    last.information_need.aggregation?.type === "sum"
  );
}

function continuar(
  understanding: ConversationUnderstanding,
  continuation: ConversationUnderstanding["continuation"],
): ConversationUnderstanding {
  return ConversationUnderstandingSchema.parse({
    ...understanding,
    goal: "continue",
    continuation,
  });
}

function specDePeriodoRelativo(mensagem: string | undefined, dataAtual: string | undefined): PeriodSpec | undefined {
  if (!mensagem || !dataAtual) return undefined;
  const extraido = periodo_relativo_da_mensagem(mensagem, dataAtual);
  if (!extraido) return undefined;
  if (extraido.origem === "mes_passado") return { tipo: "mes_passado" };
  if (extraido.origem === "mes_atual") return { tipo: "mes_atual" };
  if (
    extraido.origem === "dia_semana" ||
    extraido.origem === "ontem" ||
    extraido.origem === "hoje" ||
    extraido.origem === "anteontem" ||
    extraido.origem === "amanha"
  ) {
    return { tipo: "personalizado", de: extraido.de, ate: extraido.ate };
  }
  return undefined;
}

const RELATIVE_DIA: Record<string, string> = {
  Domingo: "sunday",
  Sábado: "saturday",
  Segunda: "monday",
  Terça: "tuesday",
  Quarta: "wednesday",
  Quinta: "thursday",
  Sexta: "friday",
};

/**
 * "e no sábado?" / "e domingo?" / "e mês passado?" com last_query:
 * period_shift sem LLM — depois de um detalhe o modelo trata sábado como correção da data.
 */
export function understandingPeriodShiftDaMensagem(
  mensagem: string,
  context: ConversationContext,
  dataAtual: string,
): ConversationUnderstanding | null {
  if (!context.last_query || !mensagem || !dataAtual) return null;
  if (!eh_followup_periodo(mensagem, dataAtual)) return null;
  const extraido = periodo_relativo_da_mensagem(mensagem, dataAtual);
  const spec = specDePeriodoRelativo(mensagem, dataAtual);
  if (!extraido || !spec) return null;
  const relative =
    extraido.origem === "dia_semana" && extraido.nomeDia
      ? (RELATIVE_DIA[extraido.nomeDia] ?? extraido.de)
      : relativeDePeriodo(spec);
  const fontes = context.last_query.information_need.data_sources;
  return ConversationUnderstandingSchema.parse({
    goal: "continue",
    continuation: {
      type: "period_shift",
      reference: { type: "temporal", relative },
      inherits_from_previous: true,
    },
    confidence: 0.9,
    required_sources: fontes.length > 0 ? fontes : ["transactions"],
  });
}

export type OpcoesCoerirUnderstanding = {
  mensagem?: string;
  dataAtual?: string;
};

/**
 * Completa o Understanding com o tópico da sessão quando o LLM omitiu `continue`.
 * Follow-up de período (e sábado?) ganha do LLM. Pergunta nova completa não herda a conta anterior.
 */
export function coerirUnderstandingComContexto(
  understanding: ConversationUnderstanding,
  context: ConversationContext,
  opcoes: OpcoesCoerirUnderstanding = {},
): ConversationUnderstanding {
  if (!context.last_query) return understanding;

  if (opcoes.mensagem && opcoes.dataAtual) {
    const direto = understandingPeriodShiftDaMensagem(opcoes.mensagem, context, opcoes.dataAtual);
    if (direto) return direto;
  }

  if (GOALS_SEM_CONSULTA.has(understanding.goal)) return understanding;
  if (opcoes.mensagem && !parece_continuacao_consulta(opcoes.mensagem)) return understanding;
  if (understanding.continuation?.inherits_from_previous) return understanding;

  const intent = understanding.question?.intent;
  if (intent && INTENTS_NOVA_ANALISE.has(intent)) return understanding;

  const entities = understanding.question?.entities;
  const periodoMensagem = specDePeriodoRelativo(opcoes.mensagem, opcoes.dataAtual);
  const periodoNovo = entities?.period ?? periodoMensagem;
  const periodoAnterior = context.last_query.information_need.filters?.transactions?.periodo;
  const mudouPeriodo = Boolean(periodoNovo) && !periodosIguais(periodoNovo, periodoAnterior);
  const pediuPeriodoNaMensagem = Boolean(periodoMensagem);
  const pedeLista = intent === "list" || intent === "detail";

  if (soComplementoOrigem(entities) && !mudouPeriodo && !pediuPeriodoNaMensagem) {
    const nome = (ehRotuloPerfil(entities?.card) ? undefined : entities?.card)
      ?? (ehRotuloPerfil(entities?.account) ? undefined : entities?.account)
      ?? "filtro";
    return continuar(understanding, {
      type: "filter_add",
      reference: { type: "merchant", name: nome },
      inherits_from_previous: true,
    });
  }

  if ((mudouPeriodo || pediuPeriodoNaMensagem) && !temAlvoNovo(entities) && !pedeLista) {
    const periodo = periodoNovo ?? periodoMensagem;
    return continuar(understanding, {
      type: "period_shift",
      reference: { type: "temporal", relative: relativeDePeriodo(periodo!) },
      inherits_from_previous: true,
    });
  }

  const mesmoAssunto = !temAlvoNovo(entities) && !mudouPeriodo && !pediuPeriodoNaMensagem;
  if (!mesmoAssunto) return understanding;

  if (pedeLista || lastFoiTotal(context)) {
    return continuar(understanding, {
      type: "detail_request",
      reference: { type: "anaphoric", pronoun: "that" },
      inherits_from_previous: true,
    });
  }

  return continuar(understanding, {
    type: "filter_modify",
    reference: { type: "anaphoric", pronoun: "that" },
    inherits_from_previous: true,
  });
}
