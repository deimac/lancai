import { somar_dias_iso_local } from "@lancai/ia";
import {
  InformationNeedSchema,
  type ConversationContext,
  type ConversationUnderstanding,
  type DataSource,
  type EntityReference,
  type InformationNeed,
  type PeriodSpec,
  type TransactionFilters,
  type UnderstandingEntities,
  type UnderstandingIntent,
} from "@lancai/tipos";

const FONTES_PADRAO: DataSource[] = ["transactions"];

const INTENTS_COMANDO = new Set<UnderstandingIntent>(["create", "update", "delete"]);
const METRICAS_AGREGACAO = new Set(["sum", "count", "avg", "max", "min"]);

export type OpcoesUnderstandingToNeed = {
  dataAtual?: string;
};

function clonar<T>(valor: T): T {
  return structuredClone(valor);
}

function ehComando(understanding: ConversationUnderstanding): boolean {
  const goal = understanding.goal;
  if (goal === "greet" || goal === "confirm" || goal === "clarify") return true;
  const intent = understanding.question?.intent;
  if (goal === "execute" && (!intent || INTENTS_COMANDO.has(intent))) return true;
  const cont = understanding.continuation?.type;
  if (cont === "correction") return true;
  if (cont === "entity_ref" && (!intent || INTENTS_COMANDO.has(intent))) return true;
  return false;
}

function fontesDe(understanding: ConversationUnderstanding, base?: InformationNeed): DataSource[] {
  if (understanding.required_sources.length > 0) return [...understanding.required_sources];
  if (base?.data_sources.length) return [...base.data_sources];
  const metric = understanding.question?.entities?.metric;
  if (metric === "balance") return ["accounts"];
  if (metric === "available") return ["cards"];
  const fonte = understanding.question?.implicit_filters?.fonte;
  if (fonte === "recorrencias") return ["recurrences"];
  return [...FONTES_PADRAO];
}

function chaveNome(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function ehFormaPagamento(texto: string): boolean {
  return /^(pix|ted|doc|boleto|dinheiro|especie|qr\s*pix)$/.test(chaveNome(texto));
}

function sanitizarFiltrosConsulta(filtros: TransactionFilters): TransactionFilters {
  const out: TransactionFilters = { ...filtros };
  if (out.merchant && out.contaNome && chaveNome(out.merchant) === chaveNome(out.contaNome)) {
    delete out.merchant;
  }
  const termoPix = out.merchant ?? out.descricao;
  if (out.tipos?.includes("transferencia") && termoPix && ehFormaPagamento(termoPix)) {
    out.tipos = ["despesa"];
  }
  return out;
}

function filtrosDeEntidades(
  entities: UnderstandingEntities | undefined,
  understanding?: ConversationUnderstanding,
  dataAtual?: string,
): TransactionFilters {
  const filtros: TransactionFilters = {};
  if (entities?.merchant) filtros.merchant = entities.merchant;
  if (entities?.account) filtros.contaNome = entities.account;
  if (entities?.card) filtros.cartaoNome = entities.card;
  if (entities?.category) filtros.categoriaNome = entities.category;
  if (entities?.period) filtros.periodo = entities.period;

  if (!filtros.periodo && understanding) {
    const refs = [
      understanding.continuation?.reference,
      ...(understanding.explicit_references ?? []),
    ].filter((r): r is NonNullable<typeof r> => Boolean(r));
    for (const ref of refs) {
      const periodo = periodoDaReferencia(ref, dataAtual);
      if (periodo) {
        filtros.periodo = periodo;
        break;
      }
    }
  }

  return sanitizarFiltrosConsulta(filtros);
}

function mesclarFiltros(
  base: TransactionFilters | undefined,
  extra: TransactionFilters,
): TransactionFilters | undefined {
  const out: TransactionFilters = { ...base };
  for (const [chave, valor] of Object.entries(extra)) {
    if (valor !== undefined) (out as Record<string, unknown>)[chave] = valor;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function removerFiltroPorReferencia(
  filtros: TransactionFilters | undefined,
  referencia: EntityReference,
): TransactionFilters | undefined {
  if (!filtros) return undefined;
  const out: TransactionFilters = { ...filtros };
  if (referencia.type === "merchant") delete out.merchant;
  if (referencia.type === "temporal") delete out.periodo;
  if (referencia.type === "composite") {
    let acc: TransactionFilters | undefined = out;
    for (const parte of referencia.parts) {
      acc = removerFiltroPorReferencia(acc, parte);
    }
    return acc;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function periodoDeRelative(relative: string, dataAtual?: string): PeriodSpec | undefined {
  const r = relative.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{M}/gu, "");
  if (r === "last_month" || r.includes("mes passado") || r.includes("mes_passado")) {
    return { tipo: "mes_passado" };
  }
  if (r === "this_month" || r.includes("mes atual") || r.includes("este mes") || r === "mes_atual") {
    return { tipo: "mes_atual" };
  }
  if (r === "today" || r === "hoje") {
    if (!dataAtual) return undefined;
    return { tipo: "personalizado", de: dataAtual, ate: dataAtual };
  }
  if (r === "yesterday" || r === "ontem") {
    if (!dataAtual) return undefined;
    const dia = somar_dias_iso_local(dataAtual, -1);
    return { tipo: "personalizado", de: dia, ate: dia };
  }
  if (r === "last_week" || r.includes("semana passada") || r.includes("last week")) {
    if (!dataAtual) return undefined;
    return { tipo: "personalizado", de: somar_dias_iso_local(dataAtual, -7), ate: dataAtual };
  }
  return undefined;
}

function periodoDaReferencia(referencia: EntityReference, dataAtual?: string): PeriodSpec | undefined {
  if (referencia.type === "temporal") return periodoDeRelative(referencia.relative, dataAtual);
  if (referencia.type === "composite") {
    for (const parte of referencia.parts) {
      const periodo = periodoDaReferencia(parte, dataAtual);
      if (periodo) return periodo;
    }
  }
  return undefined;
}

function tipoAgregacao(
  intent: UnderstandingIntent | undefined,
  metric: UnderstandingEntities["metric"] | undefined,
): InformationNeed["aggregation"] {
  if (intent === "list" || intent === "detail") {
    return { type: "none", field: "valor" };
  }
  if (metric === "balance" || metric === "available") {
    return undefined;
  }
  if (intent === "breakdown") {
    return { type: "sum", field: "valor", group_by: ["category"] };
  }
  if (intent === "top") {
    return { type: "sum", field: "valor", group_by: ["merchant"] };
  }
  if (intent === "total" || metric === "sum" || metric === "count" || metric === "avg" || metric === "max" || metric === "min") {
    const type = metric && METRICAS_AGREGACAO.has(metric) ? (metric as "sum" | "count" | "avg" | "max" | "min") : "sum";
    return { type, field: "valor" };
  }
  return undefined;
}

function saidaEsperada(
  intent: UnderstandingIntent | undefined,
  base?: InformationNeed["expected_output"],
): InformationNeed["expected_output"] {
  switch (intent) {
    case "total":
      return "single_value";
    case "list":
    case "detail":
      return "list";
    case "compare":
      return "comparison";
    case "explain":
      return "explanation";
    case "trend":
    case "projection":
      return "chart";
    case "top":
    case "breakdown":
      return "table";
    default:
      return base ?? "list";
  }
}

function computacaoDe(
  intent: UnderstandingIntent | undefined,
  entities: UnderstandingEntities | undefined,
): InformationNeed["computation"] {
  const tipo = entities?.computation;
  if (intent === "compare") {
    return { type: tipo === "pct_change" || tipo === "diff" ? tipo : "diff" };
  }
  if (intent === "explain") return { type: "explanation" };
  if (intent === "trend" || intent === "projection") return { type: "trend" };
  if (intent === "top") return { type: "top_n", params: { n: 5 } };
  if (intent === "breakdown") {
    return { type: "breakdown", params: { group_by: "category" } };
  }
  if (tipo === "diff" || tipo === "pct_change" || tipo === "trend" || tipo === "top_n" || tipo === "breakdown" || tipo === "explanation") {
    return { type: tipo };
  }
  return undefined;
}

function aplicarContinuacao(
  need: InformationNeed,
  understanding: ConversationUnderstanding,
  dataAtual?: string,
): InformationNeed {
  const cont = understanding.continuation;
  if (!cont) return need;
  const tx = need.filters?.transactions;
  const atualizado: InformationNeed = { ...need, filters: need.filters ? { ...need.filters } : undefined };

  if (cont.type === "period_shift") {
    const periodo = periodoDaReferencia(cont.reference, dataAtual);
    if (periodo) {
      atualizado.filters = {
        ...atualizado.filters,
        transactions: mesclarFiltros(tx, { periodo }),
      };
    }
  }

  if (cont.type === "filter_add" || cont.type === "filter_modify") {
    const extra = filtrosDeEntidades(understanding.question?.entities, understanding, dataAtual);
    if (
      cont.reference.type === "merchant" &&
      !extra.merchant &&
      !extra.cartaoNome &&
      !extra.contaNome
    ) {
      extra.merchant = cont.reference.name;
    }
    atualizado.filters = {
      ...atualizado.filters,
      transactions: mesclarFiltros(tx, extra),
    };
  }

  if (cont.type === "filter_remove") {
    atualizado.filters = {
      ...atualizado.filters,
      transactions: removerFiltroPorReferencia(tx, cont.reference),
    };
  }

  if (cont.type === "detail_request") {
    atualizado.expected_output = "list";
    atualizado.aggregation = { type: "none", field: "valor" };
    atualizado.computation = undefined;
  }

  return atualizado;
}

function filtrosContaCartao(
  entities: UnderstandingEntities | undefined,
  fontes: DataSource[],
  base?: InformationNeed["filters"],
): InformationNeed["filters"] {
  const filters: NonNullable<InformationNeed["filters"]> = { ...base };
  if (entities?.account && fontes.includes("accounts")) {
    filters.accounts = { ...filters.accounts, nome: entities.account };
  }
  if (entities?.card && fontes.includes("cards")) {
    filters.cards = { ...filters.cards, nome: entities.card };
  }
  const tem =
    filters.transactions || filters.accounts || filters.cards;
  return tem ? filters : undefined;
}

/**
 * Regras determinísticas: ConversationUnderstanding → InformationNeed.
 * Create / greet / confirm / clarify / correção de fato não geram Need de agregação.
 */
export function understandingToNeed(
  understanding: ConversationUnderstanding,
  context?: ConversationContext,
  opcoes: OpcoesUnderstandingToNeed = {},
): InformationNeed | null {
  if (ehComando(understanding)) return null;

  const herda = understanding.continuation?.inherits_from_previous === true;
  const base = herda && context?.last_query?.information_need
    ? clonar(context.last_query.information_need)
    : undefined;

  const intent = understanding.question?.intent;
  const entities = understanding.question?.entities;
  const fontes = fontesDe(understanding, base);
  const filtrosEntidade = filtrosDeEntidades(entities, understanding, opcoes.dataAtual);
  const tipo = understanding.question?.implicit_filters?.tipo;
  if (tipo) filtrosEntidade.tipos = [tipo];
  const filtrosLimpos = sanitizarFiltrosConsulta(filtrosEntidade);

  const aggregation = tipoAgregacao(intent, entities?.metric) ?? base?.aggregation;
  const computation = computacaoDe(intent, entities) ?? base?.computation;
  const groupBy =
    intent === "breakdown" ? ["category"] : aggregation?.group_by ?? base?.aggregation?.group_by;

  const transacoes = mesclarFiltros(base?.filters?.transactions, filtrosLimpos);
  const filters = filtrosContaCartao(entities, fontes, {
    ...base?.filters,
    transactions: transacoes,
  });

  const need = InformationNeedSchema.parse({
    data_sources: fontes,
    source_priority: fontes,
    filters,
    aggregation: aggregation
      ? { ...aggregation, ...(groupBy ? { group_by: groupBy } : {}) }
      : undefined,
    computation,
    expected_output: saidaEsperada(intent, base?.expected_output),
  });

  return InformationNeedSchema.parse(aplicarContinuacao(need, understanding, opcoes.dataAtual));
}
