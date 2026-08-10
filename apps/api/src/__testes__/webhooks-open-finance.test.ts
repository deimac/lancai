import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const receber = vi.fn();
const processar = vi.fn();

vi.mock("../servicos/open-finance", () => ({
  obter_servico_ingestao: () => ({ receber, processar }),
}));

vi.mock("../servicos/pos-ingestao-open-finance", () => ({
  enriquecer_apos_ingestao: vi.fn(async () => undefined),
}));

import { registrar_rotas_webhooks_open_finance } from "../rotas/webhooks-open-finance";

describe("webhooks open-finance / pluggy", () => {
  const segredo = "segredo-teste-webhook-lancai";

  beforeEach(() => {
    process.env.OPEN_FINANCE_WEBHOOK_SEGREDO = segredo;
    receber.mockReset();
    processar.mockReset();
    receber.mockResolvedValue({
      novo: true,
      interpretado: {
        eventoId: "evt-1",
        tipoBruto: "item/updated",
        notificacao: { tipo: "conexao_estado", conexaoExterna: "item-1" },
      },
    });
    processar.mockResolvedValue({
      criados: 0,
      duplicados: 0,
      atualizados: 0,
      removidos: 0,
      semDestino: 0,
      paginas: 0,
      movimentoIdsCriados: [],
    });
  });

  afterEach(() => {
    delete process.env.OPEN_FINANCE_WEBHOOK_SEGREDO;
  });

  async function app_com_rotas() {
    const app = Fastify({ logger: false });
    await app.register(registrar_rotas_webhooks_open_finance, { prefix: "/api/webhooks" });
    return app;
  }

  it("aceita POST /api/webhooks/pluggy com o header de segredo", async () => {
    const app = await app_com_rotas();
    const resposta = await app.inject({
      method: "POST",
      url: "/api/webhooks/pluggy",
      headers: { "x-lancai-webhook": segredo },
      payload: {
        eventId: "evt-1",
        event: "item/updated",
        itemId: "item-1",
      },
    });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toEqual({ ok: true });
    expect(receber).toHaveBeenCalledOnce();
    expect(processar).toHaveBeenCalledOnce();
    await app.close();
  });

  it("mantém o path canônico /api/webhooks/open-finance", async () => {
    const app = await app_com_rotas();
    const resposta = await app.inject({
      method: "POST",
      url: "/api/webhooks/open-finance",
      headers: { "x-lancai-webhook": segredo },
      payload: { eventId: "evt-1", event: "item/created", itemId: "item-1" },
    });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toEqual({ ok: true });
    await app.close();
  });

  it("rejeita sem o header X-Lancai-Webhook", async () => {
    const app = await app_com_rotas();
    const resposta = await app.inject({
      method: "POST",
      url: "/api/webhooks/pluggy",
      payload: { eventId: "evt-1", event: "item/updated", itemId: "item-1" },
    });

    expect(resposta.statusCode).toBe(401);
    expect(receber).not.toHaveBeenCalled();
    await app.close();
  });

  it("responde 200 e não reprocessa retentativa", async () => {
    receber.mockResolvedValueOnce({
      novo: false,
      interpretado: {
        eventoId: "evt-1",
        tipoBruto: "transactions/created",
        notificacao: { tipo: "ignorada", descricao: "retentativa" },
      },
    });

    const app = await app_com_rotas();
    const resposta = await app.inject({
      method: "POST",
      url: "/api/webhooks/pluggy",
      headers: { "x-lancai-webhook": segredo },
      payload: { eventId: "evt-1", event: "transactions/created", itemId: "item-1" },
    });

    expect(resposta.statusCode).toBe(200);
    expect(processar).not.toHaveBeenCalled();
    await app.close();
  });
});
