import { describe, expect, it } from "vitest";
import { ApplicationService } from "../application/application-service";
import { MemoryIdempotencyStore } from "../application/idempotency-store";
import type { FinanceiroPort } from "../application/application-service";

const USER = "00000000-0000-4000-8000-000000000001";
const CONTA = "00000000-0000-4000-8000-000000000202";
const CAT = "00000000-0000-4000-8000-000000000201";
const WS = "00000000-0000-4000-8000-000000000010";
const MOV = "00000000-0000-4000-8000-000000000101";

function ctx(key: string) {
  return {
    authenticatedUserId: USER,
    sessionId: "00000000-0000-4000-8000-000000000301",
    idempotencyKey: key,
    traceId: "trace-1",
    stateVersion: 0,
  };
}

describe("ApplicationService", () => {
  function montar(over: Partial<FinanceiroPort> = {}) {
    const criado = { id: MOV, descricao: "Uber", valor: 50 };
    const financeiro: FinanceiroPort = {
      criarMovimento: async () => criado,
      corrigirFato: async () => criado,
      atualizarConhecimento: async () => criado,
      obterMovimento: async () => ({
        id: MOV,
        status: "realizado",
        fonte: "manual",
        usuarioId: USER,
        descricao: "Uber",
      }),
      obterConta: async () => ({ id: CONTA, ativo: true }),
      ...over,
    };
    return new ApplicationService({
      financeiro,
      catalogo: {
        workspaceId: async () => WS,
        categoriaNaoClassificado: async () => CAT,
      },
      idempotency: new MemoryIdempotencyStore(),
      auditoria: { logCommand: async () => undefined },
    });
  }

  it("cria despesa", async () => {
    const app = montar();
    const result = await app.executeCommand(
      {
        type: "create_transaction",
        input: {
          tipo: "despesa",
          valor: 50,
          dataMovimento: "2026-08-23",
          descricao: "Uber",
          contaId: CONTA,
        },
      },
      ctx("11111111-1111-4111-8111-111111111111"),
    );
    expect(result.success).toBe(true);
    expect(result.entityRef?.type).toBe("transaction");
  });

  it("pagamento de fatura no cartão marca o papel depois de criar", async () => {
    const visto: Record<string, unknown>[] = [];
    const app = montar({
      criarMovimento: async (entrada) => {
        visto.push({ etapa: "criar", ...entrada });
        return { id: MOV, descricao: String(entrada.descricao), valor: entrada.valor };
      },
      atualizarConhecimento: async (entrada) => {
        visto.push({ etapa: "conhecimento", ...entrada });
        return { id: MOV, descricao: "pagamento de fatura" };
      },
    });
    const result = await app.executeCommand(
      {
        type: "create_transaction",
        input: {
          tipo: "despesa",
          valor: 1158.55,
          dataMovimento: "2026-08-17",
          descricao: "pagamento de fatura",
          cartaoId: "00000000-0000-4000-8000-000000000204",
          papel: "pagamento_fatura",
        },
      },
      ctx("33333333-3333-4333-8333-333333333333"),
    );
    expect(result.success).toBe(true);
    expect(visto[0]?.tipo).toBe("receita");
    expect(visto[1]?.conhecimento).toEqual(
      expect.objectContaining({
        papel: "pagamento_fatura",
        cartaoFaturaId: "00000000-0000-4000-8000-000000000204",
        competenciaFatura: "2026-08",
      }),
    );
  });

  it("descrição com fatura sem slot papel não marca conhecimento", async () => {
    const visto: Record<string, unknown>[] = [];
    const app = montar({
      criarMovimento: async (entrada) => {
        visto.push({ etapa: "criar", ...entrada });
        return { id: MOV, descricao: String(entrada.descricao), valor: entrada.valor };
      },
      atualizarConhecimento: async (entrada) => {
        visto.push({ etapa: "conhecimento", ...entrada });
        return { id: MOV, descricao: "pagamento de fatura" };
      },
    });
    const result = await app.executeCommand(
      {
        type: "create_transaction",
        input: {
          tipo: "despesa",
          valor: 1158.55,
          dataMovimento: "2026-08-17",
          descricao: "pagamento de fatura",
          cartaoId: "00000000-0000-4000-8000-000000000204",
        },
      },
      ctx("44444444-4444-4444-8444-444444444444"),
    );
    expect(result.success).toBe(true);
    expect(visto[0]?.tipo).toBe("despesa");
    expect(visto.some((v) => v.etapa === "conhecimento")).toBe(false);
  });

  it("idempotência: mesma key retorna cached", async () => {
    const app = montar();
    const key = "22222222-2222-4222-8222-222222222222";
    const r1 = await app.executeCommand(
      {
        type: "create_transaction",
        input: { valor: 50, descricao: "Uber", contaId: CONTA, dataMovimento: "2026-08-23" },
      },
      ctx(key),
    );
    const r2 = await app.executeCommand(
      {
        type: "create_transaction",
        input: { valor: 50, descricao: "Uber", contaId: CONTA, dataMovimento: "2026-08-23" },
      },
      ctx(key),
    );
    expect(r2.idempotent).toBe(true);
    expect((r2.data as { id: string }).id).toBe((r1.data as { id: string }).id);
  });

  it("revalidação: movimento cancelado", async () => {
    const app = montar({
      obterMovimento: async () => ({
        id: MOV,
        status: "cancelado",
        fonte: "manual",
        usuarioId: USER,
        descricao: "Uber",
      }),
    });
    const result = await app.executeCommand(
      { type: "cancel_transaction", input: { movementId: MOV } },
      ctx("33333333-3333-4333-8333-333333333333"),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("cancelado");
  });

  it("conta inativa", async () => {
    const app = montar({ obterConta: async () => ({ id: CONTA, ativo: false }) });
    const result = await app.executeCommand(
      {
        type: "create_transaction",
        input: { valor: 10, descricao: "X", contaId: CONTA, dataMovimento: "2026-08-23" },
      },
      ctx("44444444-4444-4444-8444-444444444444"),
    );
    expect(result.success).toBe(false);
  });
});
