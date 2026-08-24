import { describe, expect, it, vi } from "vitest";
import type { OrquestradorIA } from "@lancai/ia";
import { ConversationUnderstandingSchema, estadoInicialConversacaoV3 } from "@lancai/tipos";
import { UnderstandingExtractor } from "../agente/understanding-extractor";
import { understandingToNeed } from "../agente/understanding-to-need";
import {
  HISTORICO_MAX_TURNOS,
  montarPromptSistemaUnderstanding,
  montarPromptUsuarioUnderstanding,
} from "../prompts/understanding";
import {
  AGORA,
  CASOS_UNDERSTANDING,
  contextoAposConsultaUber,
  DATA_ATUAL,
} from "./casos-understanding";

function stubLlm(retorno: unknown) {
  const gerar = vi.fn().mockResolvedValue(retorno);
  const orquestrador = { gerar_objeto_estruturado: gerar } as unknown as OrquestradorIA;
  return { orquestrador, gerar };
}

describe("prompt understanding", () => {
  it("ensina enums, nomes em vez de IDs e continuation types", () => {
    const system = montarPromptSistemaUnderstanding();
    expect(system).toContain("answer | execute | clarify | confirm | greet | continue");
    expect(system).toContain("period_shift");
    expect(system).toContain("correction");
    expect(system).toMatch(/NUNCA use contaId/i);
    expect(system).toContain('NÃO use continuation.type "temporal"');
    expect(system).toContain("mes_atual");
    expect(system).toMatch(/Pix, TED, boleto/i);
    expect(system).toMatch(/entradas/i);
    expect(system).toMatch(/fluxo cruzado/i);
    expect(system).toContain("tipoGasto");
    expect(system).toContain("origemPerfil");
  });

  it("serializa mensagem, contexto compacto e no máximo 8 turnos", () => {
    const historico = Array.from({ length: 12 }, (_, i) => ({
      papel: "usuario" as const,
      conteudo: `msg:${String(i + 1).padStart(2, "0")}`,
    }));
    const prompt = montarPromptUsuarioUnderstanding({
      mensagem: "E mês passado?",
      context: contextoAposConsultaUber(),
      historico,
      dataAtual: DATA_ATUAL,
    });
    expect(prompt).toContain("E mês passado?");
    expect(prompt).toContain(DATA_ATUAL);
    expect(prompt).toContain("Uber");
    expect(prompt).toContain("msg:12");
    expect(prompt).not.toContain("msg:01");
    expect(prompt).not.toContain("msg:04");
    expect(prompt).toContain("msg:05");
    expect((prompt.match(/msg:/g) ?? []).length).toBe(HISTORICO_MAX_TURNOS);
  });
});

describe("UnderstandingExtractor", () => {
  it("chama o LLM com schema Zod, estágio understanding e devolve o golden", async () => {
    const caso = CASOS_UNDERSTANDING[0]!;
    const { orquestrador, gerar } = stubLlm(caso.understanding);
    const extractor = new UnderstandingExtractor(orquestrador);
    const lido = await extractor.extract({
      mensagem: caso.mensagem,
      context: caso.context ?? estadoInicialConversacaoV3(AGORA),
      dataAtual: DATA_ATUAL,
    });
    expect(lido.goal).toBe("execute");
    expect(lido.question?.entities).toMatchObject({ merchant: "Uber", amount: 50, account: "Nubank" });
    expect(gerar).toHaveBeenCalledTimes(1);
    const args = gerar.mock.calls[0]?.[0] as {
      schema: unknown;
      estagio: string;
      system: string;
      prompt: string;
    };
    expect(args.estagio).toBe("understanding");
    expect(args.schema).toBe(ConversationUnderstandingSchema);
    expect(args.system).toContain("UnderstandingExtractor");
    expect(args.prompt).toContain(caso.mensagem);
  });

  it("revalida com Zod e lança se o LLM devolver goal inválido", async () => {
    const { orquestrador } = stubLlm({
      goal: "chat",
      confidence: 1,
      required_sources: [],
    });
    const extractor = new UnderstandingExtractor(orquestrador);
    await expect(
      extractor.extract({
        mensagem: "oi",
        context: estadoInicialConversacaoV3(AGORA),
      }),
    ).rejects.toThrow();
  });

  it("repassa só os últimos 8 turnos no prompt", async () => {
    const golden = CASOS_UNDERSTANDING.find((c) => c.id === "greet")!.understanding;
    const { orquestrador, gerar } = stubLlm(golden);
    const extractor = new UnderstandingExtractor(orquestrador);
    const historico = Array.from({ length: 10 }, (_, i) => ({
      papel: "usuario" as const,
      conteudo: `hist:${String(i).padStart(2, "0")}`,
    }));
    await extractor.extract({
      mensagem: "Oi",
      context: estadoInicialConversacaoV3(AGORA),
      historico,
      dataAtual: DATA_ATUAL,
    });
    const prompt = (gerar.mock.calls[0]?.[0] as { prompt: string }).prompt;
    expect(prompt).toContain("hist:09");
    expect(prompt).not.toContain("hist:00");
    expect(prompt).not.toContain("hist:01");
  });

  it.each(CASOS_UNDERSTANDING.map((c) => [c.id, c] as const))(
    "devolve o understanding golden de %s",
    async (_id, caso) => {
      const { orquestrador } = stubLlm(caso.understanding);
      const extractor = new UnderstandingExtractor(orquestrador);
      const lido = await extractor.extract({
        mensagem: caso.mensagem,
        context: caso.context ?? estadoInicialConversacaoV3(AGORA),
        historico: caso.historico,
        dataAtual: caso.dataAtual ?? DATA_ATUAL,
      });
      expect(lido).toEqual(caso.understanding);
    },
  );
});

describe("understandingToNeed", () => {
  it(`cobre ${CASOS_UNDERSTANDING.length} casos golden (≥ 30)`, () => {
    expect(CASOS_UNDERSTANDING.length).toBeGreaterThanOrEqual(30);
  });

  it.each(CASOS_UNDERSTANDING.map((c) => [c.id, c] as const))(
    "%s",
    (_id, caso) => {
      const obtido = understandingToNeed(caso.understanding, caso.context, {
        dataAtual: caso.dataAtual ?? DATA_ATUAL,
        mensagem: caso.mensagem,
      });
      expect(obtido).toEqual(caso.need);
    },
  );

  it("create não gera Need de agregação", () => {
    const create = CASOS_UNDERSTANDING.find((c) => c.id === "create-uber-nubank")!;
    expect(understandingToNeed(create.understanding)).toBeNull();
  });

  it("Pix + tipo transferencia vira despesa (Open Finance não usa transferencia)", () => {
    const need = understandingToNeed(
      ConversationUnderstandingSchema.parse({
        goal: "answer",
        question: {
          intent: "total",
          entities: { merchant: "pix", account: "Mercado Pago", metric: "sum" },
          implicit_filters: { tipo: "transferencia" },
        },
        confidence: 0.9,
        required_sources: ["transactions"],
      }),
    );
    expect(need?.filters?.transactions?.tipos).toEqual(["despesa"]);
    expect(need?.filters?.transactions?.merchant).toBe("pix");
  });

  it("não usa o nome da conta como merchant", () => {
    const need = understandingToNeed(
      ConversationUnderstandingSchema.parse({
        goal: "answer",
        question: {
          intent: "total",
          entities: { merchant: "Mercado Pago", account: "Mercado Pago", metric: "sum" },
          implicit_filters: { tipo: "despesa" },
        },
        confidence: 0.9,
        required_sources: ["transactions"],
      }),
    );
    expect(need?.filters?.transactions?.merchant).toBeUndefined();
    expect(need?.filters?.transactions?.contaNome).toBe("Mercado Pago");
  });

  it("entradas na mensagem força receita mesmo se o extractor omitir o tipo", () => {
    const need = understandingToNeed(
      ConversationUnderstandingSchema.parse({
        goal: "answer",
        question: {
          intent: "total",
          entities: { account: "Mercado Pago", metric: "sum", period: { tipo: "mes_atual" } },
        },
        confidence: 0.8,
        required_sources: ["transactions"],
      }),
      undefined,
      { mensagem: "quanto tive de entradas este mes na minha conta mercado pago?" },
    );
    expect(need?.filters?.transactions?.tipos).toEqual(["receita"]);
    expect(need?.filters?.transactions?.contaNome).toBe("Mercado Pago");
  });

  it("gastos pessoais na conta da empresa vira fluxo cruzado, não conta chamada empresa", () => {
    const need = understandingToNeed(
      ConversationUnderstandingSchema.parse({
        goal: "answer",
        question: {
          intent: "total",
          entities: { account: "empresa", metric: "sum", period: { tipo: "mes_atual" } },
          implicit_filters: { tipo: "despesa", tipoGasto: "pf", origemPerfil: "pj" },
        },
        confidence: 0.8,
        required_sources: ["transactions"],
      }),
      undefined,
      { mensagem: "quanto tive de gastos pessoais na conta da empresa esse mes?" },
    );
    expect(need?.filters?.transactions?.cruzado).toBe(true);
    expect(need?.filters?.transactions?.direcao).toBe("pessoal_com_empresa");
    expect(need?.filters?.transactions?.contaNome).toBeUndefined();
    expect(need?.filters?.transactions?.tipos).toEqual(["despesa"]);
  });

  it("paráfrase sem as palavras pessoais/empresa ainda deriva cruzado pelos slots", () => {
    const need = understandingToNeed(
      ConversationUnderstandingSchema.parse({
        goal: "answer",
        question: {
          intent: "total",
          entities: { metric: "sum", period: { tipo: "mes_atual" } },
          implicit_filters: { tipo: "despesa", tipoGasto: "pf", origemPerfil: "pj" },
        },
        confidence: 0.9,
        required_sources: ["transactions"],
      }),
      undefined,
      { mensagem: "o que eu usei da PJ pra coisa minha esse mes?" },
    );
    expect(need?.filters?.transactions?.cruzado).toBe(true);
    expect(need?.filters?.transactions?.direcao).toBe("pessoal_com_empresa");
    expect(need?.filters?.transactions?.perfil).toBeUndefined();
  });

  it("regex só entra se o Understanding omitir os dois slots", () => {
    const need = understandingToNeed(
      ConversationUnderstandingSchema.parse({
        goal: "answer",
        question: {
          intent: "total",
          entities: { metric: "sum", period: { tipo: "mes_atual" } },
          implicit_filters: { tipo: "despesa" },
        },
        confidence: 0.8,
        required_sources: ["transactions"],
      }),
      undefined,
      { mensagem: "quanto tive de gastos pessoais na conta da empresa esse mes?" },
    );
    expect(need?.filters?.transactions?.cruzado).toBe(true);
  });

  it("extrato da conta da empresa não é cruzado", () => {
    const need = understandingToNeed(
      ConversationUnderstandingSchema.parse({
        goal: "answer",
        question: {
          intent: "total",
          entities: { account: "empresa", metric: "sum", period: { tipo: "mes_atual" } },
          implicit_filters: { tipo: "despesa", origemPerfil: "pj" },
        },
        confidence: 0.9,
        required_sources: ["transactions"],
      }),
      undefined,
      { mensagem: "quanto gastei na conta da empresa esse mes?" },
    );
    expect(need?.filters?.transactions?.cruzado).toBeUndefined();
    expect(need?.filters?.transactions?.origemPerfil).toBe("pj");
    expect(need?.filters?.transactions?.contaNome).toBeUndefined();
  });

  it("só tipoGasto vira perfil no histórico, não fluxo", () => {
    const need = understandingToNeed(
      ConversationUnderstandingSchema.parse({
        goal: "answer",
        question: {
          intent: "total",
          entities: { metric: "sum", period: { tipo: "mes_atual" } },
          implicit_filters: { tipo: "despesa", tipoGasto: "pf" },
        },
        confidence: 0.9,
        required_sources: ["transactions"],
      }),
    );
    expect(need?.filters?.transactions?.perfil).toBe("pf");
    expect(need?.filters?.transactions?.cruzado).toBeUndefined();
  });
});
