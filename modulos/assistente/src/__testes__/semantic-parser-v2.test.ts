import { describe, expect, it } from "vitest";
import type { ConversationState, UserRequest } from "@lancai/tipos";
import { estadoInicialConversacao } from "@lancai/tipos";
import { SemanticParserV2 } from "../agente/semantic-parser-v2";

const USER = "00000000-0000-4000-8000-000000000001";

function state(): ConversationState {
  return estadoInicialConversacao();
}

function parser() {
  return new SemanticParserV2({
    contextoDe: () => ({
      dataAtual: "2026-08-23",
      contas: [
        { nome: "Nubank", perfil: "pf" },
        { nome: "Itaú", perfil: "pf" },
        { nome: "Itau", perfil: "pf" },
      ],
      cartoes: [{ nome: "Nubank", perfil: "pf", modalidade: "credito", temConta: false }],
      categorias: [],
      pessoas: [],
      habitos: [],
      historicoRecente: [],
    }),
  });
}

describe("SemanticParserV2", () => {
  describe("Atalhos determinísticos", () => {
    it('atalho "lancamento": "gastei 50 no uber no nubank"', async () => {
      const result = await parser().parse({
        mensagem: "gastei 50 no uber no nubank",
        state: state(),
        userId: USER,
        canal: "web",
      });
      expect(result.usedShortcut).toBe(true);
      expect(result.shortcutName).toBe("lancamento");
      expect(result.request.op).toBe("create");
      expect(result.request.resource).toBe("transaction");
      expect(result.request.params.valor).toBe(50);
      expect(String(result.request.params.descricao).toLowerCase()).toContain("uber");
      expect(result.request.references?.account).toEqual({ type: "merchant", name: "nubank" });
    });

    it('atalho "lancamento": "recebi 1000 de salário no itaú"', async () => {
      const result = await parser().parse({
        mensagem: "recebi 1000 de salário no itaú",
        state: state(),
        userId: USER,
        canal: "web",
      });
      expect(result.usedShortcut).toBe(true);
      expect(result.request.op).toBe("create");
      expect(result.request.params.valor).toBe(1000);
      expect(result.request.params.tipo).toBe("receita");
    });

    it('atalho "consulta": "quanto gastei com uber"', async () => {
      const result = await parser().parse({
        mensagem: "quanto gastei com uber",
        state: state(),
        userId: USER,
        canal: "web",
      });
      expect(result.usedShortcut).toBe(true);
      expect(result.shortcutName).toBe("consulta");
      expect(result.request.op).toBe("query");
      expect(String(result.request.params.merchant ?? result.request.params.descricao).toLowerCase()).toContain(
        "uber",
      );
    });

    it('atalho "correcao": "corrige o uber para 80"', async () => {
      const result = await parser().parse({
        mensagem: "corrige o uber para 80",
        state: state(),
        userId: USER,
        canal: "web",
      });
      expect(result.usedShortcut).toBe(true);
      expect(result.shortcutName).toBe("correcao");
      expect(result.request.op).toBe("update");
      expect(result.request.params.valor).toBe(80);
    });

    it('atalho "enriquecimento": "aquele uber foi pessoal"', async () => {
      const result = await parser().parse({
        mensagem: "aquele uber foi pessoal",
        state: state(),
        userId: USER,
        canal: "web",
      });
      expect(result.usedShortcut).toBe(true);
      expect(result.request.op).toBe("update");
      expect(result.request.params.perfil).toBe("pf");
      expect(result.request.references?.target).toMatchObject({ type: "anaphoric", pronoun: "that" });
    });

    it('atalho "recorrencia": "todo mês dia 10 netflix 55 no nubank"', async () => {
      const result = await parser().parse({
        mensagem: "todo mês dia 10 netflix 55 no nubank",
        state: state(),
        userId: USER,
        canal: "web",
      });
      expect(result.usedShortcut).toBe(true);
      expect(result.shortcutName).toBe("recorrencia");
      expect(result.request.op).toBe("create");
      expect(result.request.resource).toBe("recurrence");
      expect(result.request.params.valor).toBe(55);
      expect(result.request.params.diaDoMes).toBe(10);
    });

    it('atalho "enriquecimento": "não considera ifood nos relatórios"', async () => {
      const result = await parser().parse({
        mensagem: "não considera ifood nos relatórios",
        state: state(),
        userId: USER,
        canal: "web",
      });
      expect(result.usedShortcut).toBe(true);
      expect(result.shortcutName).toBe("enriquecimento");
      expect(result.request.params.ignoradoEmRelatorio).toBe(true);
    });

    it("menu/ajuda", async () => {
      const result = await parser().parse({
        mensagem: "ajuda",
        state: state(),
        userId: USER,
        canal: "web",
      });
      expect(result.shortcutName).toBe("menu");
    });

    it("foi ontem com currentEntity → update da data", async () => {
      const st = {
        ...state(),
        currentEntity: {
          id: "00000000-0000-4000-8000-000000000101",
          type: "transaction" as const,
          label: "Uber",
        },
      };
      const result = await parser().parse({
        mensagem: "Foi ontem",
        state: st,
        userId: USER,
        canal: "web",
      });
      expect(result.shortcutName).toBe("correcao");
      expect(result.request.op).toBe("update");
      expect(result.request.params.dataMovimento).toBe("2026-08-22");
    });
  });

  describe("Referências estruturadas", () => {
    it("posicional: 'o segundo' → positional index 2", async () => {
      const st = {
        ...state(),
        lastResultSet: {
          ids: [
            "00000000-0000-4000-8000-000000000101",
            "00000000-0000-4000-8000-000000000102",
            "00000000-0000-4000-8000-000000000103",
          ],
          query: {},
          expiresAt: Date.now() + 600000,
        },
      };
      const result = await parser().parse({
        mensagem: "o segundo foi pessoal",
        state: st,
        userId: USER,
        canal: "web",
      });
      expect(result.request.references?.target).toEqual({ type: "positional", index: 2 });
      expect(result.request.params.perfil).toBe("pf");
    });

    it("temporal: 'o de ontem'", async () => {
      const result = await parser().parse({
        mensagem: "corrige o de ontem para 50",
        state: state(),
        userId: USER,
        canal: "web",
      });
      expect(result.request.references?.target).toMatchObject({ type: "temporal", relative: "yesterday" });
    });

    it("merchant: 'o uber'", async () => {
      const result = await parser().parse({
        mensagem: "o uber foi caro",
        state: state(),
        userId: USER,
        canal: "web",
      });
      expect(result.request.references?.target).toEqual({ type: "merchant", name: "uber" });
    });

    it("anafórico: 'aquele'", async () => {
      const result = await parser().parse({
        mensagem: "aquele foi pessoal",
        state: state(),
        userId: USER,
        canal: "web",
      });
      expect(result.request.references?.target).toEqual({ type: "anaphoric", pronoun: "that" });
    });

    it("valor: 'o de 50'", async () => {
      const result = await parser().parse({
        mensagem: "corrige o de 50 para 80",
        state: state(),
        userId: USER,
        canal: "web",
      });
      const target = result.request.references?.target;
      if (target?.type === "composite") {
        expect(target.parts.some((p) => p.type === "value" && p.amount === 50)).toBe(true);
      } else {
        expect(target).toEqual({ type: "value", amount: 50 });
      }
      expect(result.request.params.valor).toBe(80);
    });

    it("conta: 'no nubank'", async () => {
      const result = await parser().parse({
        mensagem: "gastei 50 no nubank",
        state: state(),
        userId: USER,
        canal: "web",
      });
      expect(result.request.references?.account).toEqual({ type: "merchant", name: "nubank" });
    });
  });

  describe("Slot filling", () => {
    it("lançamento sem valor gera warning", async () => {
      const result = await parser().parse({
        mensagem: "menu",
        state: state(),
        userId: USER,
        canal: "web",
      });
      expect(result.shortcutName).toBe("menu");
    });
  });

  describe("LLM Fallback", () => {
    it("caso não coberto por atalhos → usa LLM", async () => {
      const llmRequest: UserRequest = {
        op: "query",
        resource: "transaction",
        params: { merchant: "padaria" },
        meta: { source: "llm", confidence: 0.7 },
      };
      const p = new SemanticParserV2({
        llm: { parse: async () => llmRequest },
      });
      const result = await p.parse({
        mensagem: "me explica o fluxo de caixa da padaria do seu zé no trimestre",
        state: state(),
        userId: USER,
        canal: "web",
      });
      expect(result.usedShortcut).toBe(false);
      expect(result.request.meta?.source).toBe("llm");
    });
  });

  describe("Multimodal", () => {
    it("usa intencaoPrevia", async () => {
      const result = await parser().parse({
        mensagem: "confirma",
        state: state(),
        userId: USER,
        canal: "whatsapp",
        intencaoPrevia: {
          op: "create",
          resource: "transaction",
          params: { valor: 42, descricao: "Uber" },
        },
      });
      expect(result.shortcutName).toBe("multimodal");
      expect(result.request.params.valor).toBe(42);
      expect(result.request.meta?.source).toBe("multimodal");
    });
  });
});
