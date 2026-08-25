import { describe, expect, it } from "vitest";
import {
  DialogueActSchema,
  estadoConsultaNovo,
  queryStateFromSpec,
  queryStateToSpec,
} from "../assistente-conversa";

describe("QueryState adapter", () => {
  it("preserva origemPerfil do spec e do need", () => {
    const query = queryStateFromSpec(
      { tipos: ["despesa"], aggregation: "sum", visionType: "historico" },
      { filters: { transactions: { origemPerfil: "pj", tipos: ["despesa"] } } },
    );
    expect(query.origemPerfil).toBe("pj");
    expect(query.tipoGasto).toBeUndefined();
    expect(queryStateToSpec(query).origemPerfil).toBe("pj");
  });

  it("new_query aplica só entityDomain e grain default", () => {
    const query = estadoConsultaNovo({ origemPerfil: "pj" });
    expect(query.entityDomain).toBe("transactions");
    expect(query.grain).toBe("summary");
    expect(query.period).toBeUndefined();
  });
});

describe("DialogueActSchema", () => {
  it("aceita patch_query com set de período", () => {
    const act = DialogueActSchema.parse({
      act: "patch_query",
      ops: [{ op: "set", slot: "period", value: { tipo: "personalizado", de: "2026-08-22", ate: "2026-08-22" } }],
    });
    expect(act.act).toBe("patch_query");
  });

  it("rejeita act desconhecido em vez de crashar o Core", () => {
    expect(DialogueActSchema.safeParse({ act: "chat" }).success).toBe(false);
  });
});
