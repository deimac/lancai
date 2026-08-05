import { appendFileSync } from "node:fs";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import {
  ErroLimiteCartaoExcedido,
  ErroRecursoNaoEncontrado,
  ErroTipoMovimentoNaoImplementado,
  ErroValidacaoFinanceira,
} from "@lancai/financeiro";
import {
  ErroCifragemCartao,
  ErroDadosIncompletos,
  ErroDadosPlasticosInvalidos,
  ErroEntidadeJaExiste,
  ErroReferenciaNaoEncontrada,
  ErroTodosProvedoresFalharam,
} from "@lancai/ia";

function registrar_falha_ia(provedores: unknown) {
  const linha = `${new Date().toISOString()} ${JSON.stringify(provedores)}\n`;
  try {
    appendFileSync("/tmp/lancai-ia-falhas.log", linha);
  } catch {
    // ignore
  }
  console.error("[ia] todos os provedores falharam:", JSON.stringify(provedores));
}

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
    erro instanceof ErroEntidadeJaExiste ||
    erro instanceof ErroDadosPlasticosInvalidos ||
    erro instanceof ErroCifragemCartao
  ) {
    return resposta.status(422).send({ erro: erro.message });
  }

  if (erro instanceof ErroTodosProvedoresFalharam) {
    const provedores = erro.detalhes.map((item) => ({
      provedor: item.provedor,
      erro:
        item.erro instanceof Error
          ? { name: item.erro.name, message: item.erro.message }
          : item.erro,
    }));
    requisicao.log.error({ provedores }, "Todos os provedores de IA falharam");
    registrar_falha_ia(provedores);
    return resposta.status(503).send({ erro: "Nenhum provedor de IA respondeu. Tente novamente em instantes." });
  }

  requisicao.log.error(erro);
  return resposta.status(500).send({ erro: "Erro interno do servidor." });
}
