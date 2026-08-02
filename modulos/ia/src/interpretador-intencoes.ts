import { z } from "zod";
import { schemaIntencaoDetectada } from "@lancai/tipos";
import type { IntencaoDetectada } from "@lancai/tipos";
import type { OrquestradorIA } from "./orquestrador-ia";
import type { ContextoInterpretacao } from "./prompt";
import { montar_prompt_sistema, montar_prompt_usuario } from "./prompt";

export type { ContextoInterpretacao } from "./prompt";

/**
 * `schemaIntencaoDetectada` é uma união discriminada, que vira `anyOf` na raiz do JSON Schema.
 * A API de saída estruturada da Gemini aceita `anyOf` na raiz, mas a de provedores no padrão
 * OpenAI (Groq, OpenRouter, OpenAI, Ollama) exige que a raiz seja sempre `type: "object"` — por
 * isso embrulhamos a união num campo único só para a chamada à IA, e desembrulhamos o resultado
 * depois. Mantém `IntencaoDetectada` (usado em todo o resto do módulo) sem essa camada extra.
 */
const schemaRespostaInterpretador = z.object({
  intencao_detectada: schemaIntencaoDetectada,
});

/**
 * Transforma uma mensagem em linguagem natural em uma `IntencaoDetectada`
 * estruturada (ver pacotes/tipos/src/intencoes.ts). Nunca acessa o banco de
 * dados diretamente — depende do `OrquestradorIA` para falar com o provedor
 * de LLM e recebe o contexto (contas, cartões, categorias, pessoas, hábitos)
 * já pronto de quem a chama.
 */
export class InterpretadorIntencoes {
  constructor(private readonly orquestrador: OrquestradorIA) {}

  async interpretar_mensagem(
    mensagem: string,
    contexto: ContextoInterpretacao,
  ): Promise<IntencaoDetectada> {
    const resultado = await this.orquestrador.gerar_objeto_estruturado({
      schema: schemaRespostaInterpretador,
      system: montar_prompt_sistema(),
      prompt: montar_prompt_usuario(mensagem, contexto),
    });
    return resultado.intencao_detectada;
  }
}
