import { formatarMoeda } from "@lancai/tipos";
import type { IntencaoDetectada } from "@lancai/tipos";
import type { MotorFinanceiro } from "@lancai/financeiro";
import type { ResolvedorIntencao } from "@lancai/ia";
import type { ModuloRelatorios } from "@lancai/relatorios";
import { montar_resposta_visao } from "./montar-resposta-visao";

interface ContextoResposta {
  usuarioId: string;
  criadoPor: string;
  resolvedor: ResolvedorIntencao;
  motor: MotorFinanceiro;
  relatorios: ModuloRelatorios;
  /** Data de hoje (YYYY-MM-DD) — usada pelo ModuloRelatorios para períodos padrão (mês atual, últimos meses etc.). */
  dataAtual: string;
  /** Contagens ANTES deste turno — usadas para saber se é a 1ª conta/cartão (onboarding). */
  totalContas: number;
  totalCartoes: number;
}

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Executa a intenção detectada contra o MotorFinanceiro/ModuloRelatorios (via
 * ResolvedorIntencao) e devolve o texto de confirmação/resposta que o usuário
 * vê no chat.
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

    case "CONSULTAR_VISAO": {
      const filtros = await contexto.resolvedor.resolver_consultar_visao(intencao, referenciaResolucao);
      const resultado = await contexto.relatorios.consultar_visao(intencao.tipo_visao, filtros, contexto.dataAtual);
      return montar_resposta_visao(resultado);
    }

    case "CRIAR_CONTA": {
      const eraPrimeiraConta = contexto.totalContas === 0;
      const conta = await contexto.resolvedor.resolver_criar_conta(intencao, referenciaResolucao);
      const confirmacao = `Conta "${conta.nome}" criada com saldo de ${formatarMoeda(conta.saldoAtual)} (${
        conta.perfil === "pj" ? "empresa" : "pessoal"
      }).`;

      if (eraPrimeiraConta) {
        return `${confirmacao} Quer cadastrar um cartão de crédito também, ou já pode começar a registrar seus gastos e receitas por aqui.`;
      }
      return confirmacao;
    }

    case "CRIAR_CARTAO": {
      const eraPrimeiroCartao = contexto.totalCartoes === 0;
      const cartao = await contexto.resolvedor.resolver_criar_cartao(intencao, referenciaResolucao);
      const confirmacao = `Cartão "${cartao.nome}" criado — limite de ${formatarMoeda(cartao.limite)}, fecha dia ${cartao.fechamento} e vence dia ${cartao.vencimento}.`;

      if (eraPrimeiroCartao) {
        return `${confirmacao} Já pode começar a registrar suas compras nesse cartão só me contando o que comprou.`;
      }
      return confirmacao;
    }

    case "SOLICITAR_INFORMACAO":
      return intencao.pergunta;

    case "MENU":
      return 'Digite "menu" ou "ajuda" a qualquer momento para ver os comandos disponíveis.';

    case "NAO_RECONHECIDA":
      return intencao.motivo || "Não entendi essa mensagem. Pode reformular?";
  }
}
