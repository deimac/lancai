import type { OrquestradorIA } from "@lancai/ia";
import { DialogueActSchema, hojeISO, type ConversationContext, type DialogueAct } from "@lancai/tipos";
import {
  HISTORICO_MAX_TURNOS_ACT,
  montarPromptSistemaDialogueAct,
  montarPromptUsuarioDialogueAct,
  type TurnoDialogueAct,
} from "../prompts/dialogue-act";

export type EntradaDialogueActExtractor = {
  mensagem: string;
  context: ConversationContext;
  historico?: TurnoDialogueAct[];
  dataAtual?: string;
};

export class DialogueActInvalidoError extends Error {
  constructor(readonly detalhe: string) {
    super("DialogueAct inválido");
    this.name = "DialogueActInvalidoError";
  }
}

/**
 * Única chamada LLM do pipeline V3: mensagem + QueryState + ResultContext → DialogueAct.
 * Sem atalho de frase. Zod inválido vira erro para o Core esclarecer, não crash.
 */
export class DialogueActExtractor {
  constructor(private readonly orquestrador: OrquestradorIA) {}

  async extract(input: EntradaDialogueActExtractor): Promise<DialogueAct> {
    const dataAtual = input.dataAtual ?? hojeISO();
    const historico = (input.historico ?? []).slice(-HISTORICO_MAX_TURNOS_ACT);
    const bruto = await this.orquestrador.gerar_objeto_estruturado({
      schema: DialogueActSchema,
      estagio: "understanding",
      system: montarPromptSistemaDialogueAct(),
      prompt: montarPromptUsuarioDialogueAct({
        mensagem: input.mensagem,
        context: input.context,
        historico,
        dataAtual,
      }),
    });
    const lido = DialogueActSchema.safeParse(bruto);
    if (!lido.success) {
      throw new DialogueActInvalidoError(lido.error.message);
    }
    return lido.data;
  }
}
