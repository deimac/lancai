import { eh_followup_periodo } from "@lancai/ia";
import {
  DialogueActSchema,
  PeriodSpecSchema,
  type ConversationContext,
  type DialogueAct,
  type PeriodSpec,
  type QueryNames,
  type QueryState,
  type SlotOp,
} from "@lancai/tipos";
import { specDePeriodoRelativo } from "./coerir-understanding";

const ISO_DIA = /^\d{4}-\d{2}-\d{2}$/;

function periodoValido(value: unknown): PeriodSpec | undefined {
  const lido = PeriodSpecSchema.safeParse(value);
  if (!lido.success) return undefined;
  if (lido.data.de && !ISO_DIA.test(lido.data.de)) return undefined;
  if (lido.data.ate && !ISO_DIA.test(lido.data.ate)) return undefined;
  return lido.data;
}

function opsDeParcial(parcial: Partial<QueryState>, periodo: PeriodSpec | undefined): SlotOp[] {
  const ops: SlotOp[] = [];
  if (periodo) ops.push({ op: "set", slot: "period", value: periodo });
  const campos: Array<Exclude<keyof QueryState, "period" | "offset" | "contaId" | "cartaoId" | "categoriaId" | "pessoaId">> = [
    "comparison",
    "tipos",
    "tipoGasto",
    "origemPerfil",
    "cruzado",
    "direcao",
    "canal",
    "merchant",
    "descricao",
    "grain",
    "sort",
    "limit",
    "entityDomain",
  ];
  for (const slot of campos) {
    const value = parcial[slot];
    if (value === undefined) continue;
    ops.push({ op: "set", slot, value });
  }
  return ops;
}

function reescreverOps(ops: SlotOp[], fallback: PeriodSpec | undefined, injetar: boolean): SlotOp[] {
  let viuPeriodo = false;
  const out: SlotOp[] = [];
  for (const op of ops) {
    if (op.slot !== "period") {
      out.push(op);
      continue;
    }
    viuPeriodo = true;
    if (op.op === "clear") {
      out.push(op);
      continue;
    }
    const periodo = periodoValido(op.value) ?? fallback;
    if (periodo) out.push({ op: "set", slot: "period", value: periodo });
  }
  if (injetar && fallback && !viuPeriodo) {
    out.unshift({ op: "set", slot: "period", value: fallback });
  }
  return out;
}

function namesDoAct(act: DialogueAct): QueryNames | undefined {
  if (act.act === "new_query" || act.act === "patch_query") return act.names;
  return undefined;
}

/**
 * Código aplica o período relativo da mensagem. O LLM escolhe a operação;
 * de/ate inválidos (`<sábado>`, "sábado") não podem derrubar o turno.
 * Follow-up com consulta anterior vira patch (CARRYOVER), não new_query.
 */
export function coerirDialogueActComContexto(
  act: DialogueAct,
  context: ConversationContext,
  opcoes: { mensagem?: string; dataAtual?: string } = {},
): DialogueAct {
  const periodoMsg = specDePeriodoRelativo(opcoes.mensagem, opcoes.dataAtual);
  const temQuery = Boolean(context.query || context.last_query);
  const followup = Boolean(
    opcoes.mensagem &&
      opcoes.dataAtual &&
      temQuery &&
      periodoMsg &&
      eh_followup_periodo(opcoes.mensagem, opcoes.dataAtual),
  );

  if (act.act === "new_query") {
    const period = periodoValido(act.query.period) ?? periodoMsg;
    const query = period ? { ...act.query, period } : { ...act.query };
    if (act.query.period !== undefined && !period && periodoMsg) query.period = periodoMsg;
    if (followup && periodoMsg) {
      return DialogueActSchema.parse({
        act: "patch_query",
        ops: opsDeParcial(query, periodoMsg),
        names: act.names,
      });
    }
    return DialogueActSchema.parse({ act: "new_query", query, names: act.names });
  }

  if (act.act === "patch_query") {
    return DialogueActSchema.parse({
      act: "patch_query",
      ops: reescreverOps(act.ops, periodoMsg, followup),
      names: act.names,
    });
  }

  if (followup && periodoMsg && (act.act === "update" || act.act === "delete" || act.act === "write")) {
    return DialogueActSchema.parse({
      act: "patch_query",
      ops: [{ op: "set", slot: "period", value: periodoMsg }],
      names: namesDoAct(act),
    });
  }

  return act;
}
