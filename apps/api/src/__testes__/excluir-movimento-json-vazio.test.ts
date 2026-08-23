import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { ErroContaSincronizada, ErroFatoImutavel } from "@lancai/financeiro";
import { aceitar_json_sem_corpo } from "../servidor";
import { tratar_erro } from "../tratar-erro";

async function app_minimo() {
  const app = Fastify({ logger: false });
  aceitar_json_sem_corpo(app);
  app.setErrorHandler(tratar_erro);
  app.delete("/eco", async () => ({ ok: true }));
  app.post("/eco", async (requisicao) => ({ corpo: requisicao.body ?? null }));
  return app;
}

describe("DELETE com application/json vazio", () => {
  it("não devolve 500 quando o cliente manda Content-Type sem corpo", async () => {
    const app = await app_minimo();
    const resposta = await app.inject({
      method: "DELETE",
      url: "/eco",
      headers: { "content-type": "application/json" },
    });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toEqual({ ok: true });
    await app.close();
  });

  it("continua parseando JSON no POST", async () => {
    const app = await app_minimo();
    const resposta = await app.inject({
      method: "POST",
      url: "/eco",
      headers: { "content-type": "application/json" },
      payload: { a: 1 },
    });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toEqual({ corpo: { a: 1 } });
    await app.close();
  });
});

describe("tratar_erro", () => {
  it("não mascara Fato imutável e conta sincronizada como 500", async () => {
    const app = Fastify({ logger: false });
    app.setErrorHandler(tratar_erro);
    app.get("/imutavel", async () => {
      throw new ErroFatoImutavel("Padaria");
    });
    app.get("/sync", async () => {
      throw new ErroContaSincronizada("Nubank", "cancelar");
    });

    const imutavel = await app.inject({ method: "GET", url: "/imutavel" });
    expect(imutavel.statusCode).toBe(422);
    expect(imutavel.json().erro).toContain("Padaria");

    const sync = await app.inject({ method: "GET", url: "/sync" });
    expect(sync.statusCode).toBe(422);
    expect(sync.json().erro).toContain("Nubank");
    await app.close();
  });
});
