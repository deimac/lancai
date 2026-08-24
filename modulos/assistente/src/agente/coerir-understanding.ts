import {
  ConversationUnderstandingSchema,
  type ConversationContext,
  type ConversationUnderstanding,
  type PeriodSpec,
  type UnderstandingEntities,
  type UnderstandingIntent,
} from "@lancai/tipos";

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

/**
 * Completa o Understanding com o tópico da sessão quando o LLM omitiu `continue`.
 * Não lê a redação da mensagem: só last_query + slots já extraídos.
 */
export function coerirUnderstandingComContexto(
  understanding: ConversationUnderstanding,
  context: ConversationContext,
): ConversationUnderstanding {
  if (!context.last_query) return understanding;
  if (GOALS_SEM_CONSULTA.has(understanding.goal)) return understanding;
  if (understanding.continuation?.inherits_from_previous) return understanding;

  const intent = understanding.question?.intent;
  if (intent && INTENTS_NOVA_ANALISE.has(intent)) return understanding;

  const entities = understanding.question?.entities;
  const periodoNovo = entities?.period;
  const periodoAnterior = context.last_query.information_need.filters?.transactions?.periodo;
  const mudouPeriodo = Boolean(periodoNovo) && !periodosIguais(periodoNovo, periodoAnterior);

  if (soComplementoOrigem(entities) && !mudouPeriodo) {
    const nome = (ehRotuloPerfil(entities?.card) ? undefined : entities?.card)
      ?? (ehRotuloPerfil(entities?.account) ? undefined : entities?.account)
      ?? "filtro";
    return continuar(understanding, {
      type: "filter_add",
      reference: { type: "merchant", name: nome },
      inherits_from_previous: true,
    });
  }

  if (mudouPeriodo && !temAlvoNovo(entities)) {
    return continuar(understanding, {
      type: "period_shift",
      reference: { type: "temporal", relative: relativeDePeriodo(periodoNovo!) },
      inherits_from_previous: true,
    });
  }

  const mesmoAssunto = !temAlvoNovo(entities) && !mudouPeriodo;
  if (!mesmoAssunto) return understanding;

  const pedeLista = intent === "list" || intent === "detail";
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
