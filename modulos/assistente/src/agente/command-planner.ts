import { extrair_dia_da_semana, somar_dias_iso_local } from "@lancai/ia";
import {
  CommandPlanSchema,
  hojeISO,
  type Ambiguity,
  type CommandPlan,
  type ConversationUnderstanding,
  type DialogueAct,
  type EntityReference,
  type ResolutionResult,
  type SimpleCommand,
} from "@lancai/tipos";

export type CommandPlanResult =
  | { kind: "plan"; plan: CommandPlan }
  | { kind: "clarify"; ambiguity: Ambiguity[] }
  | { kind: "unresolved"; resolution: ResolutionResult }
  | null;

export type OpcoesCommandPlanner = {
  resolved?: ResolutionResult;
  dataAtual?: string;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function ambiguidades(understanding: ConversationUnderstanding): Ambiguity[] {
  return [...(understanding.ambiguity ?? []), ...(understanding.question?.ambiguity ?? [])];
}

function registro(valor: unknown): Record<string, unknown> {
  if (valor && typeof valor === "object" && !Array.isArray(valor)) {
    return valor as Record<string, unknown>;
  }
  return {};
}

function dataDeRelative(relative: string, dataAtual: string): string | undefined {
  const r = relative.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{M}/gu, "");
  if (r === "today" || r === "hoje") return dataAtual;
  if (r === "yesterday" || r === "ontem") return somar_dias_iso_local(dataAtual, -1);
  if (r === "last_week" || r.includes("semana")) return somar_dias_iso_local(dataAtual, -7);
  if (/^\d{4}-\d{2}-\d{2}$/.test(relative.trim())) return relative.trim();
  const dia = extrair_dia_da_semana(relative, dataAtual);
  if (dia) return dia.iso;
  return undefined;
}

function dataDaReferencia(ref: EntityReference | undefined, dataAtual: string): string | undefined {
  if (!ref) return undefined;
  if (ref.type === "temporal") return dataDeRelative(ref.relative, dataAtual);
  if (ref.type === "composite") {
    for (const parte of ref.parts) {
      const data = dataDaReferencia(parte, dataAtual);
      if (data) return data;
    }
  }
  return undefined;
}

function movementIdResolvido(resolved: ResolutionResult | undefined): string | undefined {
  if (resolved?.status !== "resolved") return undefined;
  const id = resolved.entity.entity.id;
  return UUID.test(id) ? id : undefined;
}

function ehRecorrencia(understanding: ConversationUnderstanding): boolean {
  if (understanding.question?.implicit_filters?.fonte === "recorrencias") return true;
  const extra = registro(understanding.question?.entities?.value);
  return extra.recorrente === true || extra.recorrencia === true;
}

function ehRegra(understanding: ConversationUnderstanding): boolean {
  const intent = understanding.question?.intent;
  const entities = understanding.question?.entities;
  if (intent !== "create") return false;
  if (!entities?.category || entities.amount != null) return false;
  if (entities.merchant) return true;
  return registro(entities.value).regra === true;
}

function planoDe(command: SimpleCommand, description: string): CommandPlanResult {
  return {
    kind: "plan",
    plan: CommandPlanSchema.parse({
      type: "command",
      steps: [{ stepId: "1", command, description }],
    }),
  };
}

function precisaAlvo(understanding: ConversationUnderstanding): boolean {
  const intent = understanding.question?.intent;
  if (intent === "update" || intent === "delete") return true;
  if (understanding.continuation?.type === "correction") return true;
  return false;
}

/**
 * ConversationUnderstanding → CommandPlan. Sem inventar UUID.
 * Ambiguidade / alvo não resolvido não viram step de execução.
 */
export function planCommand(
  understanding: ConversationUnderstanding,
  opcoes: OpcoesCommandPlanner = {},
): CommandPlanResult {
  const listaAmbiguas = ambiguidades(understanding);
  if (listaAmbiguas.length > 0) return { kind: "clarify", ambiguity: listaAmbiguas };

  const goal = understanding.goal;
  if (goal === "greet" || goal === "confirm" || goal === "clarify" || goal === "answer") return null;

  const intent = understanding.question?.intent;
  const ehCorrecao = understanding.continuation?.type === "correction";
  if (goal === "continue" && !ehCorrecao && intent !== "update" && intent !== "delete" && intent !== "create") {
    return null;
  }
  if (goal === "execute" && intent && !["create", "update", "delete"].includes(intent) && !ehCorrecao) {
    return null;
  }
  if (!intent && !ehCorrecao) return null;

  if (precisaAlvo(understanding)) {
    const resolved = opcoes.resolved;
    if (!resolved) return { kind: "unresolved", resolution: { status: "not_found", reason: "Alvo não resolvido" } };
    if (resolved.status === "ambiguous") return { kind: "unresolved", resolution: resolved };
    if (resolved.status === "not_found") return { kind: "unresolved", resolution: resolved };
  }

  const entities = understanding.question?.entities;
  const extra = registro(entities?.value);
  const dataAtual = opcoes.dataAtual ?? hojeISO();
  const tipo = understanding.question?.implicit_filters?.tipo;

  if (intent === "create" && ehRecorrencia(understanding)) {
    const descricao = entities?.merchant ?? "Recorrência";
    const valor = entities?.amount;
    if (valor == null || valor <= 0) {
      return { kind: "clarify", ambiguity: [{ field: "amount", reason: "valor da recorrência ausente" }] };
    }
    const dia = typeof extra.diaDoMes === "number" ? extra.diaDoMes : 1;
    return planoDe(
      {
        type: "create_recurrence",
        input: { descricao, valor, diaDoMes: dia },
      },
      `Criar recorrência ${descricao}`,
    );
  }

  if (ehRegra(understanding)) {
    const merchant = entities?.merchant;
    const categoriaId = typeof extra.categoriaId === "string" ? extra.categoriaId : undefined;
    if (!merchant) {
      return { kind: "clarify", ambiguity: [{ field: "merchant", reason: "merchant da regra ausente" }] };
    }
    if (!categoriaId || !UUID.test(categoriaId)) {
      return { kind: "clarify", ambiguity: [{ field: "category", reason: "categoria ainda não resolvida para UUID" }] };
    }
    return planoDe(
      { type: "create_rule", input: { merchant, categoriaId } },
      `Criar regra ${merchant}`,
    );
  }

  if (intent === "create") {
    return planoDe(
      {
        type: "create_transaction",
        input: {
          descricao: entities?.merchant,
          valor: entities?.amount,
          tipo,
        },
      },
      `Lançar ${entities?.merchant ?? "movimento"}`,
    );
  }

  const movementId = movementIdResolvido(opcoes.resolved);
  if ((intent === "update" || intent === "delete" || ehCorrecao) && !movementId) {
    return {
      kind: "unresolved",
      resolution: opcoes.resolved ?? { status: "not_found", reason: "movementId ausente" },
    };
  }

  if (intent === "delete") {
    return planoDe(
      { type: "cancel_transaction", input: { movementId: movementId! } },
      "Cancelar lançamento",
    );
  }

  if (intent === "update" || ehCorrecao) {
    const fatoPatch: NonNullable<Extract<SimpleCommand, { type: "update_transaction" }>["input"]["fatoPatch"]> = {};
    const conhecimentoPatch: NonNullable<
      Extract<SimpleCommand, { type: "update_transaction" }>["input"]["conhecimentoPatch"]
    > = {};

    if (entities?.amount != null) fatoPatch.valor = entities.amount;
    const data =
      typeof extra.dataMovimento === "string"
        ? extra.dataMovimento
        : dataDaReferencia(understanding.continuation?.reference, dataAtual);
    if (data) fatoPatch.dataMovimento = data;

    if (extra.perfil === "pf" || extra.perfil === "pj") conhecimentoPatch.perfil = extra.perfil;
    if (Array.isArray(extra.tags)) conhecimentoPatch.tags = extra.tags.filter((t): t is string => typeof t === "string");
    if (typeof extra.observacoes === "string") conhecimentoPatch.observacoes = extra.observacoes;
    if (typeof extra.categoriaId === "string" && UUID.test(extra.categoriaId)) {
      conhecimentoPatch.categoriaId = extra.categoriaId;
    } else if (entities?.category && !extra.categoriaId) {
      return { kind: "clarify", ambiguity: [{ field: "category", reason: "categoria ainda não resolvida para UUID" }] };
    }

    const temFato = Object.keys(fatoPatch).length > 0;
    const temConhecimento = Object.keys(conhecimentoPatch).length > 0;
    if (!temFato && !temConhecimento) {
      return { kind: "clarify", ambiguity: [{ field: "value", reason: "nada para alterar" }] };
    }

    return planoDe(
      {
        type: "update_transaction",
        input: {
          movementId: movementId!,
          fatoPatch: temFato ? fatoPatch : undefined,
          conhecimentoPatch: temConhecimento ? conhecimentoPatch : undefined,
        },
      },
      "Atualizar lançamento",
    );
  }

  return null;
}

function numeroDoPatch(patch: Record<string, unknown>, ...chaves: string[]): number | undefined {
  for (const chave of chaves) {
    const valor = patch[chave];
    if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  }
  return undefined;
}

function textoDoPatch(patch: Record<string, unknown>, ...chaves: string[]): string | undefined {
  for (const chave of chaves) {
    const valor = patch[chave];
    if (typeof valor === "string" && valor.trim()) return valor;
  }
  return undefined;
}

/**
 * DialogueAct de escrita → CommandPlan. Usado na produção (sem Understanding).
 */
export function planCommandFromAct(
  act: Extract<DialogueAct, { act: "write" | "update" | "delete" }>,
  opcoes: OpcoesCommandPlanner = {},
): CommandPlanResult {
  const dataAtual = opcoes.dataAtual ?? hojeISO();

  if (act.act === "write") {
    const intent = act.intent;
    if (intent.valor == null || intent.valor <= 0) {
      return { kind: "clarify", ambiguity: [{ field: "amount", reason: "valor ausente" }] };
    }
    const dataISO = intent.data
      ? /^\d{4}-\d{2}-\d{2}$/.test(intent.data)
        ? intent.data
        : dataDeRelative(intent.data, dataAtual)
      : undefined;
    return planoDe(
      {
        type: "create_transaction",
        input: {
          descricao: intent.descricao,
          valor: intent.valor,
          tipo: intent.tipo,
          dataMovimento: dataISO,
        },
      },
      `Lançar ${intent.descricao ?? "movimento"}`,
    );
  }

  const resolved = opcoes.resolved;
  if (!resolved) return { kind: "unresolved", resolution: { status: "not_found", reason: "Alvo não resolvido" } };
  if (resolved.status === "ambiguous" || resolved.status === "not_found") {
    return { kind: "unresolved", resolution: resolved };
  }
  const movementId = movementIdResolvido(resolved);
  if (!movementId) {
    return { kind: "unresolved", resolution: { status: "not_found", reason: "movementId ausente" } };
  }

  if (act.act === "delete") {
    return planoDe({ type: "cancel_transaction", input: { movementId } }, "Cancelar lançamento");
  }

  const patch = act.patch;
  const fatoPatch: NonNullable<Extract<SimpleCommand, { type: "update_transaction" }>["input"]["fatoPatch"]> = {};
  const conhecimentoPatch: NonNullable<
    Extract<SimpleCommand, { type: "update_transaction" }>["input"]["conhecimentoPatch"]
  > = {};

  const valor = numeroDoPatch(patch, "valor", "amount");
  if (valor != null) fatoPatch.valor = valor;

  const dataBruta = textoDoPatch(patch, "dataMovimento", "data");
  if (dataBruta) {
    const data = /^\d{4}-\d{2}-\d{2}$/.test(dataBruta) ? dataBruta : dataDeRelative(dataBruta, dataAtual);
    if (data) fatoPatch.dataMovimento = data;
  }

  const perfil = patch.perfil;
  if (perfil === "pf" || perfil === "pj") conhecimentoPatch.perfil = perfil;
  if (Array.isArray(patch.tags)) {
    conhecimentoPatch.tags = patch.tags.filter((t): t is string => typeof t === "string");
  }
  if (typeof patch.observacoes === "string") conhecimentoPatch.observacoes = patch.observacoes;
  const categoriaId = textoDoPatch(patch, "categoriaId");
  if (categoriaId && UUID.test(categoriaId)) conhecimentoPatch.categoriaId = categoriaId;

  const temFato = Object.keys(fatoPatch).length > 0;
  const temConhecimento = Object.keys(conhecimentoPatch).length > 0;
  if (!temFato && !temConhecimento) {
    return { kind: "clarify", ambiguity: [{ field: "value", reason: "nada para alterar" }] };
  }

  return planoDe(
    {
      type: "update_transaction",
      input: {
        movementId,
        fatoPatch: temFato ? fatoPatch : undefined,
        conhecimentoPatch: temConhecimento ? conhecimentoPatch : undefined,
      },
    },
    "Atualizar lançamento",
  );
}

export class CommandPlanner {
  plan(understanding: ConversationUnderstanding, opcoes?: OpcoesCommandPlanner): CommandPlanResult {
    return planCommand(understanding, opcoes);
  }
}
