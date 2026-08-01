import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import {
  ErroLimiteCartaoExcedido,
  ErroRecursoNaoEncontrado,
  ErroTipoMovimentoNaoImplementado,
  ErroValidacaoFinanceira,
} from "@lancai/financeiro";

export function tratar_erro(erro: unknown, requisicao: FastifyRequest, resposta: FastifyReply) {
  if (erro instanceof ZodError) {
    return resposta.status(400).send({ erro: "Dados inválidos.", detalhes: erro.issues });
  }

  if (erro instanceof ErroRecursoNaoEncontrado) {
    return resposta.status(404).send({ erro: erro.message });
  }

  if (
    erro instanceof ErroValidacaoFinanceira ||
    erro instanceof ErroLimiteCartaoExcedido ||
    erro instanceof ErroTipoMovimentoNaoImplementado
  ) {
    return resposta.status(422).send({ erro: erro.message });
  }

  requisicao.log.error(erro);
  return resposta.status(500).send({ erro: "Erro interno do servidor." });
}
