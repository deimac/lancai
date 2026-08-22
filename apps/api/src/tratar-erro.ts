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
  ErroReferenciaAmbiguo,
  ErroReferenciaNaoEncontrada,
  ErroTodosProvedoresFalharam,
} from "@lancai/ia";
import {
  ErroAssociacaoInvalida,
  ErroConexaoNaoEncontrada,
  ErroContaExternaNaoEncontrada,
  ErroProvedorIndisponivel,
} from "@lancai/open-finance";
import {
  ErroConhecimentoInvalido,
  ErroMovimentoNaoEncontrado,
} from "@lancai/conhecimento";
import { ErroVisaoAgregadaSomenteLeitura } from "@lancai/banco";
import { ErroValidacaoSenhaIndisponivel } from "./verificar-senha-usuario";

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

  if (
    erro &&
    typeof erro === "object" &&
    "statusCode" in erro &&
    (erro as { statusCode?: number }).statusCode === 413
  ) {
    return resposta.status(413).send({ erro: "O arquivo é grande demais (máximo 12 MB)." });
  }

  if (
    erro instanceof ErroRecursoNaoEncontrado ||
    erro instanceof ErroConexaoNaoEncontrada ||
    erro instanceof ErroContaExternaNaoEncontrada ||
    erro instanceof ErroMovimentoNaoEncontrado
  ) {
    return resposta.status(404).send({ erro: erro.message });
  }

  if (erro instanceof ErroVisaoAgregadaSomenteLeitura) {
    return resposta.status(400).send({ erro: erro.message });
  }

  if (
    erro instanceof ErroValidacaoFinanceira ||
    erro instanceof ErroLimiteCartaoExcedido ||
    erro instanceof ErroTipoMovimentoNaoImplementado ||
    erro instanceof ErroReferenciaNaoEncontrada ||
    erro instanceof ErroReferenciaAmbiguo ||
    erro instanceof ErroDadosIncompletos ||
    erro instanceof ErroEntidadeJaExiste ||
    erro instanceof ErroDadosPlasticosInvalidos ||
    erro instanceof ErroCifragemCartao ||
    erro instanceof ErroAssociacaoInvalida ||
    erro instanceof ErroConhecimentoInvalido
  ) {
    return resposta.status(422).send({ erro: erro.message });
  }

  if (erro instanceof ErroValidacaoSenhaIndisponivel) {
    return resposta.status(503).send({ erro: erro.message });
  }

  if (erro instanceof ErroProvedorIndisponivel) {
    return resposta.status(502).send({
      erro:
        "O banco não aceitou a atualização agora. Se pediu sync há pouco, aguarde e tente de novo; " +
        "se a credencial mudou, use Reconectar.",
    });
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
