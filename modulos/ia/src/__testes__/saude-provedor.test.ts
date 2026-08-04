import { afterEach, describe, expect, it, vi } from "vitest";
import { ErroTodosProvedoresFalharam } from "../erros";
import { OrquestradorIA, resetar_circuitos_provedores } from "../orquestrador-ia";
import {
  definir_verificador_saude_para_testes,
  obter_metricas_provedores,
  provedor_esta_saudavel,
  registrar_falha_saude_provedor,
  resetar_cache_saude_provedores,
  resetar_metricas_provedores,
} from "../saude-provedor";
import { z } from "zod";

describe("provedor_esta_saudavel", () => {
  const envOriginal = { ...process.env };

  afterEach(() => {
    process.env = { ...envOriginal };
    definir_verificador_saude_para_testes(null);
    resetar_cache_saude_provedores();
    resetar_metricas_provedores();
    resetar_circuitos_provedores();
  });

  it("usa cache TTL e não chama o verificador de novo", async () => {
    const verificador = vi.fn(async () => true);
    definir_verificador_saude_para_testes(verificador);

    await expect(provedor_esta_saudavel("groq")).resolves.toBe(true);
    await expect(provedor_esta_saudavel("groq")).resolves.toBe(true);
    expect(verificador).toHaveBeenCalledTimes(1);
  });

  it("respeita falha recente no cache sem novo ping", async () => {
    const verificador = vi.fn(async () => true);
    definir_verificador_saude_para_testes(verificador);
    registrar_falha_saude_provedor("gemini");

    await expect(provedor_esta_saudavel("gemini")).resolves.toBe(false);
    expect(verificador).not.toHaveBeenCalled();
  });

  it("pula provedores frios antes de chamar a LLM", async () => {
    process.env.GROQ_API_KEY = "fake-groq";
    process.env.GEMINI_API_KEY = "fake-gemini";
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";

    const verificador = vi.fn(async () => false);
    definir_verificador_saude_para_testes(verificador);

    const orquestrador = new OrquestradorIA(["groq", "gemini", "ollama"]);

    await expect(
      orquestrador.gerar_objeto_estruturado({
        schema: z.object({ ok: z.boolean() }),
        prompt: 'responda {"ok":true}',
      }),
    ).rejects.toBeInstanceOf(ErroTodosProvedoresFalharam);

    expect(verificador).toHaveBeenCalledTimes(3);

    const metricas = obter_metricas_provedores();
    expect(metricas.groq?.puladosPorSaude).toBe(1);
    expect(metricas.gemini?.puladosPorSaude).toBe(1);
    expect(metricas.ollama?.puladosPorSaude).toBe(1);
  });
});
