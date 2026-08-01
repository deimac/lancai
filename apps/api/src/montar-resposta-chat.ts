import { formatarMoeda } from "@lancai/tipos";
import type { IntencaoDetectada } from "@lancai/tipos";
import type { MotorFinanceiro } from "@lancai/financeiro";
import type { ResolvedorIntencao } from "@lancai/ia";

interface ContextoResposta {
  usuarioId: string;
  criadoPor: string;
  resolvedor: ResolvedorIntencao;
  motor: MotorFinanceiro;
}

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Executa a intenção detectada contra o MotorFinanceiro (via ResolvedorIntencao)
 * e devolve o texto de confirmação/resposta que o usuário vê no chat.
 *
 * CONSULTAR_VISAO ainda não é resolvido de verdade aqui — depende do
 * modulos/relatorios (Fase 5); por ora devolve uma resposta amigável dizendo
 * que a consulta ainda não está disponível.
 */
export async function montar_resposta_chat(
  intencao: IntencaoDetectada,
  contexto: ContextoResposta,
): Promise<string> {
  const referenciaResolucao = { usuarioId: contexto.usuarioId, criadoPor: contexto.criadoPor };

  switch (intencao.intencao) {
    case "REGISTRAR_MOVIMENTO": {
      const entrada = await contexto.resolvedor.resolver_registrar_movimento(intencao, referenciaResolucao);
      const resultado = await contexto.motor.criar_movimento(entrada);

      if (resultado.parcelas.length > 1) {
        const primeiraParcela = resultado.parcelas[0];
        return `Compra de ${formatarMoeda(entrada.valor)} registrada em ${resultado.parcelas.length}x de ${formatarMoeda(
          primeiraParcela?.valor ?? "0",
        )} — "${entrada.descricao}".`;
      }

      if (resultado.movimentos.length === 2) {
        return `Transferência de ${formatarMoeda(entrada.valor)} registrada com sucesso.`;
      }

      return `${capitalizar(entrada.tipo)} de ${formatarMoeda(entrada.valor)} registrada em "${entrada.descricao}" (${entrada.dataMovimento}).`;
    }

    case "CORRIGIR_MOVIMENTO": {
      const entrada = await contexto.resolvedor.resolver_corrigir_movimento(intencao, referenciaResolucao);
      const movimentoAtualizado = await contexto.motor.corrigir_movimento(entrada);
      return `Lançamento "${movimentoAtualizado.descricao}" atualizado com sucesso.`;
    }

    case "CONSULTAR_VISAO":
      return `Ainda estou aprendendo a responder consultas do tipo "${intencao.tipo_visao}" — essa função chega em uma próxima fase do Lançai.`;

    case "NAO_RECONHECIDA":
      return intencao.motivo || "Não entendi essa mensagem. Pode reformular?";
  }
}
