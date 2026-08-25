import {
  PeriodSpecSchema,
  QueryStateSchema,
  canalPagamentoSchema,
  direcaoFluxoSchema,
  entityDomainSchema,
  perfilSchema,
  queryGrainSchema,
  querySortSchema,
  tipoMovimentoSchema,
  type QueryState,
  type SlotName,
  type SlotOp,
} from "@lancai/tipos";
import { z } from "zod";

const ALIAS_TIPO: Record<string, string> = {
  entrada: "receita",
  entradas: "receita",
  saida: "despesa",
  saidas: "despesa",
  gasto: "despesa",
  gastos: "despesa",
};

function chaveTipo(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

function valorDoSlot(slot: SlotName, value: unknown): unknown {
  if (slot !== "tipos" || !Array.isArray(value)) return value;
  return value.map((item) => {
    if (typeof item !== "string") return item;
    return ALIAS_TIPO[chaveTipo(item)] ?? item;
  });
}

const slotValor: Record<SlotName, z.ZodTypeAny> = {
  period: PeriodSpecSchema,
  comparison: z.object({ period: PeriodSpecSchema }),
  tipos: z.array(tipoMovimentoSchema).min(1),
  tipoGasto: perfilSchema,
  origemPerfil: perfilSchema,
  cruzado: z.boolean(),
  direcao: direcaoFluxoSchema,
  canal: canalPagamentoSchema,
  merchant: z.string().min(1),
  descricao: z.string().min(1),
  contaId: z.string().uuid(),
  cartaoId: z.string().uuid(),
  categoriaId: z.string().uuid(),
  pessoaId: z.string().uuid(),
  grain: queryGrainSchema,
  sort: querySortSchema,
  limit: z.number().int().min(1).max(500),
  entityDomain: entityDomainSchema,
};

function semUndefined(estado: QueryState): QueryState {
  const bruto: Record<string, unknown> = { entityDomain: estado.entityDomain, grain: estado.grain };
  for (const [chave, valor] of Object.entries(estado)) {
    if (valor !== undefined && valor !== null) bruto[chave] = valor;
  }
  return QueryStateSchema.parse(bruto);
}

/**
 * Aplica slot ops. Omissão = CARRYOVER. Só muta `ops.map(o => o.slot)`.
 * `set` substitui o slot inteiro; `clear` remove (undefined, nunca null).
 */
export function applySlotOps(estado: QueryState, ops: SlotOp[]): QueryState {
  const proximo: Record<string, unknown> = { ...estado };
  for (const op of ops) {
    if (op.op === "clear") {
      delete proximo[op.slot];
      continue;
    }
    proximo[op.slot] = slotValor[op.slot].parse(valorDoSlot(op.slot, op.value));
  }
  return semUndefined(proximo as QueryState);
}

export function slotsMutados(ops: SlotOp[]): SlotName[] {
  return ops.map((op) => op.slot);
}
