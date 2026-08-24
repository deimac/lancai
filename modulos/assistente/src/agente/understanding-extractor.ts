import type { OrquestradorIA } from "@lancai/ia";
import {
  ConversationUnderstandingSchema,
  hojeISO,
  type ConversationContext,
  type ConversationUnderstanding,
} from "@lancai/tipos";
import {
  HISTORICO_MAX_TURNOS,
  montarPromptSistemaUnderstanding,
  montarPromptUsuarioUnderstanding,
  type TurnoUnderstanding,
} from "../prompts/understanding";

export type EntradaUnderstandingExtractor = {
  mensagem: string;
  context: ConversationContext;
  historico?: TurnoUnderstanding[];
  dataAtual?: string;
};

/**
 * Única chamada LLM do Assistente 2.0 definitivo.
 * Não liga no AssistenteCore nesta semana — Semana 4 faz a integração.
 */
export class UnderstandingExtractor {
  constructor(private readonly orquestrador: OrquestradorIA) {}

  async extract(input: EntradaUnderstandingExtractor): Promise<ConversationUnderstanding> {
    const historico = (input.historico ?? []).slice(-HISTORICO_MAX_TURNOS);
    const bruto = await this.orquestrador.gerar_objeto_estruturado({
      schema: ConversationUnderstandingSchema,
      estagio: "understanding",
      system: montarPromptSistemaUnderstanding(),
      prompt: montarPromptUsuarioUnderstanding({
        mensagem: input.mensagem,
        context: input.context,
        historico,
        dataAtual: input.dataAtual ?? hojeISO(),
      }),
    });
    return ConversationUnderstandingSchema.parse(bruto);
  }
}
