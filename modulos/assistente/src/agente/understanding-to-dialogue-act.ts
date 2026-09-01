import { extrair_dia_da_semana, somar_dias_iso_local } from "@lancai/ia";
import {
  DialogueActSchema,
  estadoConsultaNovo,
  type ConversationContext,
  type ConversationUnderstanding,
  type DialogueAct,
  type EntityReference,
  type PeriodSpec,
  type QueryGrain,
  type QueryNames,
  type QueryState,
  type ResultRefHint,
  type SlotOp,
  type WriteIntent,
} from "@lancai/tipos";

export type OpcoesUnderstandingToAct = {
  dataAtual?: string;
  mensagem?: string;
};

function chaveNome(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function ehRotuloPerfil(nome: string): boolean {
  return /^(empresa|pessoal|pj|pf|conta da empresa|conta pessoal|conta pj|conta pf|cartao)$/.test(chaveNome(nome));
}

function periodoDeRelative(relative: string, dataAtual?: string): PeriodSpec | undefined {
  const r = relative.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{M}/gu, "");
  const iso = /^(\d{4}-\d{2}-\d{2})$/.exec(r.trim());
  if (iso) return { tipo: "personalizado", de: iso[1], ate: iso[1] };
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
  if (dataAtual) {
    const dia = extrair_dia_da_semana(relative, dataAtual);
    if (dia) return { tipo: "personalizado", de: dia.iso, ate: dia.iso };
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

function grainDeIntent(intent: string | undefined): QueryGrain {
  if (intent === "list" || intent === "detail") return "list";
  if (intent === "top") return "top";
  if (intent === "breakdown") return "category";
  if (intent === "trend" || intent === "projection") return "month";
  if (intent === "explain") return "explain";
  return "summary";
}

function temConsulta(ctx: ConversationContext): boolean {
  return Boolean(ctx.query || ctx.last_query);
}

function hintDeReferencia(ref: EntityReference | undefined): ResultRefHint | undefined {
  if (!ref) return undefined;
  if (ref.type === "positional") return { by: "ordinal", n: ref.index };
  if (ref.type === "value") return { by: "amount", value: ref.amount };
  if (ref.type === "merchant") return { by: "label", text: ref.name };
  return undefined;
}

function namesDe(understanding: ConversationUnderstanding): QueryNames | undefined {
  const entities = understanding.question?.entities;
  const names: QueryNames = {};
  if (entities?.account && !ehRotuloPerfil(entities.account)) names.contaNome = entities.account;
  if (entities?.card && !ehRotuloPerfil(entities.card)) names.cartaoNome = entities.card;
  if (entities?.category) names.categoriaNome = entities.category;
  return names.contaNome || names.cartaoNome || names.categoriaNome ? names : undefined;
}

function parcialDeQuestion(understanding: ConversationUnderstanding, dataAtual?: string): Partial<QueryState> {
  const q = understanding.question;
  const entities = q?.entities;
  const implicit = q?.implicit_filters;
  const parcial: Partial<QueryState> = {
    grain: grainDeIntent(q?.intent),
  };
  if (entities?.metric === "balance") parcial.entityDomain = "accounts";
  if (entities?.metric === "available") parcial.entityDomain = "cards";
  if (entities?.period) parcial.period = entities.period;
  if (!parcial.period) {
    const ref = understanding.continuation?.reference ?? understanding.explicit_references?.[0];
    if (ref) {
      const periodo = periodoDaReferencia(ref, dataAtual);
      if (periodo) parcial.period = periodo;
    }
  }
  if (implicit?.tipo) parcial.tipos = [implicit.tipo];
  if (implicit?.tipoGasto) parcial.tipoGasto = implicit.tipoGasto;
  if (implicit?.origemPerfil) parcial.origemPerfil = implicit.origemPerfil;
  if (implicit?.tipoGasto && implicit.origemPerfil && implicit.tipoGasto !== implicit.origemPerfil) {
    parcial.cruzado = true;
    parcial.direcao = implicit.tipoGasto === "pf" ? "pessoal_com_empresa" : "empresa_com_pessoal";
  }
  if (entities?.merchant) parcial.merchant = entities.merchant;
  if (q?.intent === "compare" && entities?.period) {
    parcial.comparison = { period: { tipo: "mes_passado" } };
  }
  return parcial;
}

function opsDeParcial(parcial: Partial<QueryState>): SlotOp[] {
  const ops: SlotOp[] = [];
  for (const [slot, value] of Object.entries(parcial)) {
    if (value === undefined || slot === "entityDomain") continue;
    ops.push({ op: "set", slot: slot as SlotOp["slot"], value });
  }
  return ops;
}

function dataDoCreate(period?: PeriodSpec): string | undefined {
  if (period?.de && /^\d{4}-\d{2}-\d{2}$/.test(period.de)) return period.de;
  if (period?.ate && /^\d{4}-\d{2}-\d{2}$/.test(period.ate)) return period.ate;
  return undefined;
}

function intentWrite(understanding: ConversationUnderstanding): WriteIntent {
  const entities = understanding.question?.entities;
  const implicit = understanding.question?.implicit_filters;
  const data = dataDoCreate(entities?.period);
  return {
    tipo: implicit?.tipo,
    valor: entities?.amount,
    descricao: entities?.merchant,
    contaNome: entities?.account,
    cartaoNome: entities?.card,
    categoriaNome: entities?.category,
    papel: implicit?.papel,
    ...(data ? { data } : {}),
  };
}

/**
 * Adapter de testes / migração: ConversationUnderstanding → DialogueAct.
 * O Core de produção usa o extractor de DialogueAct direto.
 */
export function understandingToDialogueAct(
  understanding: ConversationUnderstanding,
  context: ConversationContext,
  opcoes: OpcoesUnderstandingToAct = {},
): DialogueAct {
  if (understanding.goal === "greet") return DialogueActSchema.parse({ act: "greet" });
  if (understanding.goal === "confirm") return DialogueActSchema.parse({ act: "confirm" });

  const cont = understanding.continuation?.type;
  const intent = understanding.question?.intent;
  const dataAtual = opcoes.dataAtual;

  if (understanding.goal === "clarify") {
    return DialogueActSchema.parse({ act: "diagnose", suspicion: "unknown" });
  }

  if (cont === "correction" || intent === "update") {
    return DialogueActSchema.parse({
      act: "update",
      target: hintDeReferencia(understanding.continuation?.reference),
      patch: (understanding.question?.entities?.value as Record<string, unknown> | undefined) ?? {},
    });
  }
  if (intent === "delete") {
    return DialogueActSchema.parse({
      act: "delete",
      target: hintDeReferencia(understanding.continuation?.reference),
    });
  }
  if (understanding.goal === "execute" && intent === "create") {
    return DialogueActSchema.parse({ act: "write", intent: intentWrite(understanding) });
  }

  if (cont === "period_shift") {
    const periodo = understanding.continuation
      ? periodoDaReferencia(understanding.continuation.reference, dataAtual)
      : undefined;
    const ops: SlotOp[] = periodo ? [{ op: "set", slot: "period", value: periodo }] : [];
    return DialogueActSchema.parse({ act: "patch_query", ops });
  }

  if (cont === "detail_request" || ((intent === "list" || intent === "detail") && temConsulta(context) && !understanding.question?.entities?.merchant)) {
    return DialogueActSchema.parse({ act: "change_grain", grain: "list" });
  }

  if (cont === "filter_remove") {
    const ref = understanding.continuation?.reference;
    const ops: SlotOp[] = [];
    if (ref?.type === "merchant") ops.push({ op: "clear", slot: "merchant" });
    if (ref?.type === "temporal") ops.push({ op: "clear", slot: "period" });
    return DialogueActSchema.parse({ act: "patch_query", ops });
  }

  if (cont === "filter_add" || cont === "filter_modify") {
    const parcial = parcialDeQuestion(understanding, dataAtual);
    const ops = opsDeParcial(parcial).filter((op) => op.slot !== "grain");
    const card = understanding.question?.entities?.card;
    if (card && ehRotuloPerfil(card)) ops.push({ op: "set", slot: "canal", value: "cartao" });
    return DialogueActSchema.parse({
      act: "patch_query",
      ops,
      names: namesDe(understanding),
    });
  }

  if (intent === "explain") {
    return DialogueActSchema.parse({ act: "diagnose", suspicion: "query" });
  }

  const parcial = parcialDeQuestion(understanding, dataAtual);
  if (temConsulta(context) && understanding.goal === "continue") {
    return DialogueActSchema.parse({
      act: "patch_query",
      ops: opsDeParcial(parcial),
      names: namesDe(understanding),
    });
  }

  return DialogueActSchema.parse({
    act: "new_query",
    query: estadoConsultaNovo(parcial),
    names: namesDe(understanding),
  });
}
