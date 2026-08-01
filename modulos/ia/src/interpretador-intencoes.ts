import { schemaIntencaoDetectada } from "@lancai/tipos";
import type { IntencaoDetectada } from "@lancai/tipos";
import type { OrquestradorIA } from "./orquestrador-ia";
import type { ContextoInterpretacao } from "./prompt";
import { montar_prompt_sistema, montar_prompt_usuario } from "./prompt";

export type { ContextoInterpretacao } from "./prompt";

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
    return this.orquestrador.gerar_objeto_estruturado({
      schema: schemaIntencaoDetectada,
      system: montar_prompt_sistema(),
      prompt: montar_prompt_usuario(mensagem, contexto),
    });
  }
}
