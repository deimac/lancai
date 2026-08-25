import { eh_followup_periodo, extrair_contraparte_recebimento, inferir_escopo_fluxo_consulta, mensagem_cita_periodo, tipos_do_escopo_fluxo } from "@lancai/ia";
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

function origemDoRotulo(nome: string): "pf" | "pj" | undefined {
  const chave = chaveNome(nome);
  if (/^(empresa|pj|conta da empresa|conta pj)$/.test(chave)) return "pj";
  if (/^(pessoal|pf|conta pessoal|conta pf)$/.test(chave)) return "pf";
  return undefined;
}

/** "conta da empresa" é perfil de origem, não nome de conta. */
function origemDaMensagem(mensagem: string): "pf" | "pj" | "clear" | undefined {
  const texto = mensagem
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (/\b(tira|sem|remove)\s+(a\s+)?empresa\b/.test(texto) || /\btira\s+(o\s+)?pj\b/.test(texto)) {
    return "clear";
  }
  if (
    /\bconta\s+da\s+empresa\b/.test(texto) ||
    /\bcartao\s+da\s+empresa\b/.test(texto) ||
    /\bconta\s+pj\b/.test(texto) ||
    /\bna\s+pj\b/.test(texto)
  ) {
    return "pj";
  }
  if (/\bconta\s+pessoal\b/.test(texto) || /\bconta\s+pf\b/.test(texto) || /\bna\s+pf\b/.test(texto)) {
    return "pf";
  }
  return undefined;
}

function limparNamesPerfil(names: QueryNames | undefined): QueryNames | undefined {
  if (!names) return undefined;
  const proximo = { ...names };
  if (ehRotuloPerfil(proximo.contaNome)) delete proximo.contaNome;
  if (ehRotuloPerfil(proximo.cartaoNome)) delete proximo.cartaoNome;
  if (!proximo.contaNome && !proximo.cartaoNome && !proximo.categoriaNome) return undefined;
  return proximo;
}

function aplicarOrigemPerfil(
  query: Partial<QueryState>,
  mensagem: string | undefined,
  names?: QueryNames,
): Partial<QueryState> {
  const proximo = { ...query };
  const doNome = names?.contaNome
    ? origemDoRotulo(names.contaNome)
    : names?.cartaoNome
      ? origemDoRotulo(names.cartaoNome)
      : undefined;
  const daMensagem = mensagem ? origemDaMensagem(mensagem) : undefined;
  if (daMensagem === "clear") {
    delete proximo.origemPerfil;
    return proximo;
  }
  const origem = daMensagem === "pj" || daMensagem === "pf" ? daMensagem : doNome;
  if (origem) proximo.origemPerfil = origem;
  return proximo;
}

function aplicarEscopoEContraparte(
  query: Partial<QueryState>,
  mensagem: string | undefined,
  dataAtual: string | undefined,
): Partial<QueryState> {
  const proximo = { ...query };
  if (!mensagem) return proximo;

  const escopo = inferir_escopo_fluxo_consulta(mensagem);
  const tipos = tipos_do_escopo_fluxo(escopo);
  if (tipos) proximo.tipos = tipos;

  const contraparte = extrair_contraparte_recebimento(mensagem);
  if (contraparte) proximo.merchant = contraparte;

  const perguntaDePessoa = Boolean(contraparte);
  const receitaComNome =
    escopo === "receita" && Boolean(proximo.merchant || proximo.descricao);
  if (
    (perguntaDePessoa || receitaComNome) &&
    dataAtual &&
    !mensagem_cita_periodo(mensagem, dataAtual)
  ) {
    delete proximo.period;
  }

  return proximo;
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
    let query: Partial<QueryState> = period ? { ...act.query, period } : { ...act.query };
    if (act.query.period !== undefined && !period && periodoMsg) query.period = periodoMsg;
    query = aplicarEscopoEContraparte(query, opcoes.mensagem, opcoes.dataAtual);
    query = aplicarOrigemPerfil(query, opcoes.mensagem, act.names);
    const names = limparNamesPerfil(act.names);
    if (followup && periodoMsg) {
      return DialogueActSchema.parse({
        act: "patch_query",
        ops: opsDeParcial(query, periodoMsg),
        names,
      });
    }
    return DialogueActSchema.parse({ act: "new_query", query, names });
  }

  if (act.act === "patch_query") {
    let ops = reescreverOps(act.ops, periodoMsg, followup);
    if (opcoes.mensagem) {
      const escopo = inferir_escopo_fluxo_consulta(opcoes.mensagem);
      const tipos = tipos_do_escopo_fluxo(escopo);
      if (tipos) {
        ops = [...ops.filter((op) => op.slot !== "tipos"), { op: "set", slot: "tipos", value: tipos }];
      }
      const contraparte = extrair_contraparte_recebimento(opcoes.mensagem);
      if (contraparte) {
        ops = [...ops.filter((op) => op.slot !== "merchant"), { op: "set", slot: "merchant", value: contraparte }];
      }
      if (
        contraparte &&
        opcoes.dataAtual &&
        !mensagem_cita_periodo(opcoes.mensagem, opcoes.dataAtual)
      ) {
        ops = [...ops.filter((op) => op.slot !== "period"), { op: "clear", slot: "period" }];
      }
      const origemMsg = origemDaMensagem(opcoes.mensagem);
      if (origemMsg === "clear") {
        ops = [...ops.filter((op) => op.slot !== "origemPerfil"), { op: "clear", slot: "origemPerfil" }];
      } else if (origemMsg === "pj" || origemMsg === "pf") {
        ops = [...ops.filter((op) => op.slot !== "origemPerfil"), { op: "set", slot: "origemPerfil", value: origemMsg }];
      } else {
        const origemNome = act.names?.contaNome
          ? origemDoRotulo(act.names.contaNome)
          : act.names?.cartaoNome
            ? origemDoRotulo(act.names.cartaoNome)
            : undefined;
        if (origemNome) {
          ops = [...ops.filter((op) => op.slot !== "origemPerfil"), { op: "set", slot: "origemPerfil", value: origemNome }];
        }
      }
    }
    return DialogueActSchema.parse({
      act: "patch_query",
      ops,
      names: limparNamesPerfil(act.names),
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
