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

  it("grain top não vira soma no spec", () => {
    const query = estadoConsultaNovo({
      grain: "top",
      tipos: ["receita"],
      sort: { by: "valor", dir: "desc" },
      limit: 1,
    });
    const spec = queryStateToSpec(query);
    expect(spec.aggregation).toBe("max");
    expect(spec.limit).toBe(1);
    expect(spec.orderBy).toBe("valor");
    expect(spec.orderDir).toBe("desc");
    expect(queryStateFromSpec(spec).grain).toBe("top");
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

  it("aceita write com papel pagamento_fatura", () => {
    const act = DialogueActSchema.parse({
      act: "write",
      intent: { papel: "pagamento_fatura", valor: 1158.55, cartaoNome: "Revolut", data: "2026-08-17" },
    });
    expect(act.act).toBe("write");
    if (act.act === "write") expect(act.intent.papel).toBe("pagamento_fatura");
  });

  it("aceita delete por ordinal e faixa", () => {
    expect(
      DialogueActSchema.parse({ act: "delete", target: { by: "ordinal", n: 2 } }),
    ).toMatchObject({ act: "delete", target: { by: "ordinal", n: 2 } });
    expect(
      DialogueActSchema.parse({
        act: "delete",
        target: { by: "ordinal_range", de: 1, ate: 5 },
      }),
    ).toMatchObject({ act: "delete", target: { by: "ordinal_range", de: 1, ate: 5 } });
  });
});
