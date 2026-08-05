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

/**
 * Converte erros de domínio em texto para o usuário (WhatsApp/web).
 * Retorna null se for erro inesperado (aí cabe a mensagem genérica).
 */
export function mensagem_erro_para_usuario(erro: unknown): string | null {
  if (
    erro instanceof ErroReferenciaNaoEncontrada ||
    erro instanceof ErroDadosIncompletos ||
    erro instanceof ErroEntidadeJaExiste ||
    erro instanceof ErroDadosPlasticosInvalidos ||
    erro instanceof ErroCifragemCartao ||
    erro instanceof ErroValidacaoFinanceira ||
    erro instanceof ErroLimiteCartaoExcedido ||
    erro instanceof ErroTipoMovimentoNaoImplementado ||
    erro instanceof ErroRecursoNaoEncontrado
  ) {
    return erro.message;
  }

  if (erro instanceof ErroTodosProvedoresFalharam) {
    return "Tive uma instabilidade na IA agora. Pode tentar de novo em instantes?";
  }

  const msg = erro instanceof Error ? erro.message : String(erro);
  if (/orcamento|recorrencia|does not exist|42P01/i.test(msg)) {
    return "Ainda estou atualizando o banco (orçamento/recorrências). Tente de novo em 1 minuto — ou diga o lançamento por texto.";
  }

  return null;
}
