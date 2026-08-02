import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import {
  ErroLimiteCartaoExcedido,
  ErroRecursoNaoEncontrado,
  ErroTipoMovimentoNaoImplementado,
  ErroValidacaoFinanceira,
} from "@lancai/financeiro";
import { ErroDadosIncompletos, ErroEntidadeJaExiste, ErroReferenciaNaoEncontrada, ErroTodosProvedoresFalharam } from "@lancai/ia";

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
    erro instanceof ErroTipoMovimentoNaoImplementado ||
    erro instanceof ErroReferenciaNaoEncontrada ||
    erro instanceof ErroDadosIncompletos ||
    erro instanceof ErroEntidadeJaExiste
  ) {
    return resposta.status(422).send({ erro: erro.message });
  }

  if (erro instanceof ErroTodosProvedoresFalharam) {
    requisicao.log.error(erro.detalhes);
    return resposta.status(503).send({ erro: "Nenhum provedor de IA respondeu. Tente novamente em instantes." });
  }

  requisicao.log.error(erro);
  return resposta.status(500).send({ erro: "Erro interno do servidor." });
}
