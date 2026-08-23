import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { chat as chatTabela, obter_banco } from "@lancai/banco";
import { processar_turno_conversa } from "../servicos/processar-turno-conversa";
import { obterAssistenteCore } from "../servicos/assistente-v2";
import { gravar_turno_chat } from "../servicos/gravar-turno-chat";
import { isFlagEnabled } from "../config/feature-flags";

const schemaRequisicaoChat = z.object({
  usuarioId: z.string().uuid(),
  mensagem: z.string().min(1),
  sessaoId: z.string().uuid().optional(),
});

/**
 * HTTP thin wrapper sobre o turno conversacional compartilhado.
 * Assistente 2.0 só entra com ASSISTENTE_V2_ASSISTANT=true.
 */
export async function registrar_rotas_chat(app: FastifyInstance) {
  app.post("/", async (requisicao, resposta) => {
    const dados = schemaRequisicaoChat.parse(requisicao.body);

    if (isFlagEnabled("ASSISTENTE_V2_ASSISTANT")) {
      const resultado = await obterAssistenteCore().processar({
        usuarioId: dados.usuarioId,
        mensagem: dados.mensagem,
        sessaoId: dados.sessaoId,
        canal: "web",
      });
      if (!resultado.duplicata) {
        await gravar_turno_chat({
          sessaoId: resultado.sessaoId,
          mensagemUsuario: dados.mensagem,
          resposta: resultado.resposta,
        });
      }
      return resposta.send({
        sessaoId: resultado.sessaoId,
        resposta: resultado.resposta,
        traceId: resultado.traceId,
      });
    }

    const legado = await processar_turno_conversa({
      usuarioId: dados.usuarioId,
      mensagem: dados.mensagem,
      sessaoId: dados.sessaoId,
    });

    if (isFlagEnabled("ASSISTENTE_V2_SHADOW")) {
      void obterAssistenteCore()
        .processar({
          usuarioId: dados.usuarioId,
          mensagem: dados.mensagem,
          sessaoId: dados.sessaoId,
          canal: "web",
        })
        .then((v2) => {
          requisicao.log.info(
            {
              traceId: v2.traceId,
              shadow: true,
              legacy: { resposta: legado.resposta },
              v2: { resposta: v2.resposta, diagnostico: v2.diagnostico },
            },
            "[assistant-v2] Shadow comparison",
          );
        })
        .catch((erro) => {
          requisicao.log.warn({ err: erro, shadow: true }, "[assistant-v2] Shadow falhou");
        });
    }

    return resposta.send(legado);
  });

  app.get("/:sessaoId/mensagens", async (requisicao) => {
    const { sessaoId } = requisicao.params as { sessaoId: string };
    const banco = obter_banco();
    return banco.select().from(chatTabela).where(eq(chatTabela.sessaoId, sessaoId)).orderBy(chatTabela.dataCriacao);
  });
}
