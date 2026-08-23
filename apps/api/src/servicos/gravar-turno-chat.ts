import { chat as chatTabela, obter_banco } from "@lancai/banco";

/**
 * Persiste o par usuário/sistema do Assistente 2.0, o mesmo histórico
 * que o GET /chat/:sessaoId/mensagens lê no legado.
 */
export async function gravar_turno_chat(entrada: {
  sessaoId: string;
  mensagemUsuario: string;
  resposta: string;
}): Promise<void> {
  const banco = obter_banco();
  await banco.insert(chatTabela).values({
    sessaoId: entrada.sessaoId,
    papel: "usuario",
    conteudo: entrada.mensagemUsuario,
  });
  await banco.insert(chatTabela).values({
    sessaoId: entrada.sessaoId,
    papel: "sistema",
    conteudo: entrada.resposta,
  });
}
