import { describe, expect, it } from "vitest";
import { z } from "zod";
import { OrquestradorIA, resetar_circuitos_provedores } from "../orquestrador-ia";

const OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";

async function ollama_disponivel(): Promise<boolean> {
  try {
    const resposta = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return resposta.ok;
  } catch {
    return false;
  }
}

describe("OrquestradorIA + Ollama (integração)", () => {
  it("gera objeto estruturado com qwen2.5:3b-instruct", async () => {
    if (!(await ollama_disponivel())) {
      console.warn("Ollama indisponível — pulando teste de integração");
      return;
    }

    resetar_circuitos_provedores();
    process.env.OLLAMA_HABILITADO = "true";
    process.env.OLLAMA_BASE_URL = OLLAMA_URL;
    process.env.OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:3b-instruct";

    const orquestrador = new OrquestradorIA(["ollama"]);
    const schema = z.object({
      intencao: z.literal("CONSULTAR_VISAO"),
      tipo_visao: z.literal("historico"),
    });

    const objeto = await orquestrador.gerar_objeto_estruturado({
      schema,
      prompt:
        'O usuário perguntou: "quais os lançamentos de hoje?". Devolva JSON exatamente assim: {"intencao":"CONSULTAR_VISAO","tipo_visao":"historico"}',
    });

    expect(objeto).toEqual({ intencao: "CONSULTAR_VISAO", tipo_visao: "historico" });
  }, 90_000);
});
