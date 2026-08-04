import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { chat as chatTabela, obter_banco } from "@lancai/banco";
import { processar_turno_conversa } from "../servicos/processar-turno-conversa";

const schemaRequisicaoChat = z.object({
  usuarioId: z.string().uuid(),
  mensagem: z.string().min(1),
  sessaoId: z.string().uuid().optional(),
});

/**
 * HTTP thin wrapper sobre o turno conversacional compartilhado.
 * Fluxo completo: processar_turno_conversa (IA + resolvedor + motor).
 */
export async function registrar_rotas_chat(app: FastifyInstance) {
  app.post("/", async (requisicao, resposta) => {
    const dados = schemaRequisicaoChat.parse(requisicao.body);
    const resultado = await processar_turno_conversa({
      usuarioId: dados.usuarioId,
      mensagem: dados.mensagem,
      sessaoId: dados.sessaoId,
    });
    return resposta.send(resultado);
  });

  app.get("/:sessaoId/mensagens", async (requisicao) => {
    const { sessaoId } = requisicao.params as { sessaoId: string };
    const banco = obter_banco();
    return banco.select().from(chatTabela).where(eq(chatTabela.sessaoId, sessaoId)).orderBy(chatTabela.dataCriacao);
  });
}
