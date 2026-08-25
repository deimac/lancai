import { describe, expect, it } from "vitest";
import { estadoConsultaNovo, estadoInicialConversacaoV3, type DialogueAct } from "@lancai/tipos";
import { coerirDialogueActComContexto } from "../agente/coerir-dialogue-act";

const AGORA = 1_777_000_000_000;
const TERCA = "2026-08-25";

function ctxComQuery() {
  return {
    ...estadoInicialConversacaoV3(AGORA),
    query: estadoConsultaNovo({
      grain: "summary",
      tipos: ["receita"],
      period: { tipo: "personalizado", de: "2026-08-24", ate: "2026-08-24" },
    }),
  };
}

describe("coerirDialogueActComContexto", () => {
  it("e sábado eu tive entradas? vira patch de período ISO e não new_query", () => {
    const act: DialogueAct = {
      act: "new_query",
      query: {
        grain: "summary",
        tipos: ["receita"],
        period: { tipo: "personalizado", de: "<sábado>", ate: "<sábado>" },
      },
    };
    const coerido = coerirDialogueActComContexto(act, ctxComQuery(), {
      mensagem: "e sabado eu tive entradas?",
      dataAtual: TERCA,
    });
    expect(coerido.act).toBe("patch_query");
    if (coerido.act !== "patch_query") throw new Error("esperado patch_query");
    expect(coerido.ops).toContainEqual({
      op: "set",
      slot: "period",
      value: { tipo: "personalizado", de: "2026-08-22", ate: "2026-08-22" },
    });
    expect(coerido.ops).toContainEqual({ op: "set", slot: "tipos", value: ["receita"] });
  });

  it("substitui placeholder <sábado> no patch sem dropar outros ops", () => {
    const act: DialogueAct = {
      act: "patch_query",
      ops: [
        { op: "set", slot: "period", value: { tipo: "personalizado", de: "<sábado>", ate: "<sábado>" } },
        { op: "set", slot: "tipos", value: ["receita"] },
      ],
    };
    const coerido = coerirDialogueActComContexto(act, ctxComQuery(), {
      mensagem: "e sabado eu tive entradas?",
      dataAtual: TERCA,
    });
    expect(coerido).toEqual({
      act: "patch_query",
      ops: [
        { op: "set", slot: "period", value: { tipo: "personalizado", de: "2026-08-22", ate: "2026-08-22" } },
        { op: "set", slot: "tipos", value: ["receita"] },
      ],
    });
  });

  it("e hoje a maior entrada? mantém grain top e só corrige o período", () => {
    const act: DialogueAct = {
      act: "patch_query",
      ops: [
        { op: "set", slot: "period", value: { tipo: "personalizado", de: "<hoje>", ate: "<hoje>" } },
        { op: "set", slot: "tipos", value: ["receita"] },
        { op: "set", slot: "grain", value: "top" },
        { op: "set", slot: "sort", value: { by: "valor", dir: "desc" } },
        { op: "set", slot: "limit", value: 1 },
      ],
    };
    const coerido = coerirDialogueActComContexto(act, ctxComQuery(), {
      mensagem: "e hoje qual foi a maior entrada?",
      dataAtual: TERCA,
    });
    expect(coerido.act).toBe("patch_query");
    if (coerido.act !== "patch_query") throw new Error("esperado patch_query");
    expect(coerido.ops).toContainEqual({
      op: "set",
      slot: "period",
      value: { tipo: "personalizado", de: "2026-08-25", ate: "2026-08-25" },
    });
    expect(coerido.ops).toContainEqual({ op: "set", slot: "grain", value: "top" });
    expect(coerido.ops).toContainEqual({ op: "set", slot: "limit", value: 1 });
  });

  it("e no sábado? depois do detalhe não vira update da data", () => {
    const act: DialogueAct = {
      act: "update",
      patch: { dataMovimento: "2026-08-22" },
    };
    const coerido = coerirDialogueActComContexto(act, ctxComQuery(), {
      mensagem: "e no sábado?",
      dataAtual: TERCA,
    });
    expect(coerido).toEqual({
      act: "patch_query",
      ops: [{ op: "set", slot: "period", value: { tipo: "personalizado", de: "2026-08-22", ate: "2026-08-22" } }],
    });
  });

  it("quanto a tayna me enviou de pix? é receita pelo nome, sem inventar o mês", () => {
    const act: DialogueAct = {
      act: "new_query",
      query: {
        grain: "summary",
        tipos: ["despesa"],
        merchant: "pix",
        period: { tipo: "mes_atual" },
      },
    };
    const coerido = coerirDialogueActComContexto(act, estadoInicialConversacaoV3(AGORA), {
      mensagem: "quanto a tayna santos me enviou de pix?",
      dataAtual: TERCA,
    });
    expect(coerido).toMatchObject({
      act: "new_query",
      query: {
        grain: "summary",
        tipos: ["receita"],
        merchant: "tayna santos",
      },
    });
    if (coerido.act === "new_query") {
      expect(coerido.query.period).toBeUndefined();
    }
  });

  it("quanto recebi de pix da Tayna? não usa pix como merchant", () => {
    const act: DialogueAct = {
      act: "new_query",
      query: {
        grain: "summary",
        tipos: ["receita"],
        merchant: "pix da Tayna Santos",
        period: { tipo: "mes_atual" },
      },
    };
    const coerido = coerirDialogueActComContexto(act, estadoInicialConversacaoV3(AGORA), {
      mensagem: "quanto recebi de pix da Tayna Santos?",
      dataAtual: TERCA,
    });
    expect(coerido).toMatchObject({
      act: "new_query",
      query: {
        grain: "summary",
        tipos: ["receita"],
        merchant: "Tayna Santos",
      },
    });
    if (coerido.act === "new_query") {
      expect(coerido.query.period).toBeUndefined();
    }
  });

  it("patch depois de outra consulta não herda o período em pergunta de quem enviou", () => {
    const act: DialogueAct = {
      act: "patch_query",
      ops: [
        { op: "set", slot: "merchant", value: "pix" },
        { op: "set", slot: "tipos", value: ["despesa"] },
      ],
    };
    const coerido = coerirDialogueActComContexto(act, ctxComQuery(), {
      mensagem: "quanto a tayna santos me enviou de pix?",
      dataAtual: TERCA,
    });
    expect(coerido).toMatchObject({
      act: "patch_query",
    });
    if (coerido.act !== "patch_query") throw new Error("esperado patch_query");
    expect(coerido.ops).toContainEqual({ op: "set", slot: "tipos", value: ["receita"] });
    expect(coerido.ops).toContainEqual({ op: "set", slot: "merchant", value: "tayna santos" });
    expect(coerido.ops).toContainEqual({ op: "clear", slot: "period" });
  });

  it("conta da empresa vira origemPerfil=pj e não names.contaNome", () => {
    const act: DialogueAct = {
      act: "new_query",
      query: {
        grain: "summary",
        tipos: ["despesa"],
        period: { tipo: "mes_atual" },
      },
      names: { contaNome: "empresa" },
    };
    const coerido = coerirDialogueActComContexto(act, estadoInicialConversacaoV3(AGORA), {
      mensagem: "quanto gastei na conta da empresa este mês?",
      dataAtual: TERCA,
    });
    expect(coerido).toMatchObject({
      act: "new_query",
      query: {
        grain: "summary",
        tipos: ["despesa"],
        origemPerfil: "pj",
        period: { tipo: "mes_atual" },
      },
    });
    if (coerido.act === "new_query") {
      expect(coerido.names?.contaNome).toBeUndefined();
    }
  });
});
