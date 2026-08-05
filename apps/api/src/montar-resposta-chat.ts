import { formatarMoeda } from "@lancai/tipos";
import type { IntencaoCorrigirMovimento, IntencaoDetectada } from "@lancai/tipos";
import type { MotorFinanceiro } from "@lancai/financeiro";
import {
  ErroEntidadeJaExiste,
  extrair_codigo_da_mensagem,
  preferir_termo_referencia,
  type ResolvedorIntencao,
} from "@lancai/ia";
import type { Memoria } from "@lancai/memoria";
import type { ModuloRelatorios } from "@lancai/relatorios";
import {
  montar_confirmacao_duplicata_lancamento,
  montar_confirmacao_exclusao,
  montar_confirmacao_exclusao_lancamento,
} from "./montar-confirmacao-exclusao";
import { montar_pedido_senha_cartao } from "./montar-pedido-senha-cartao";
import { montar_resposta_visao } from "./montar-resposta-visao";
import { aprender_habitos_apos_lancamento } from "./servicos/aprender-habitos-lancamento";
import {
  definir_orcamento,
  formatar_status_orcamentos,
  listar_status_orcamentos,
  texto_alerta_orcamento_apos_despesa,
} from "./servicos/orcamento-servico";
import {
  cancelar_recorrencia,
  criar_recorrencia,
  formatar_lista_recorrencias,
  listar_recorrencias,
} from "./servicos/recorrencia-servico";

interface ContextoResposta {
  usuarioId: string;
  criadoPor: string;
  resolvedor: ResolvedorIntencao;
  motor: MotorFinanceiro;
  relatorios: ModuloRelatorios;
  memoria?: Memoria;
  /** Data de hoje (YYYY-MM-DD) — usada pelo ModuloRelatorios para períodos padrão (mês atual, últimos meses etc.). */
  dataAtual: string;
  /** Contagens ANTES deste turno — usadas para saber se é a 1ª conta/cartão (onboarding). */
  totalContas: number;
  totalCartoes: number;
  /** Mensagem original do usuário — usada para extrair termo/código da referência. */
  mensagem?: string;
}

function ajustar_referencia_correcao(
  intencao: IntencaoCorrigirMovimento,
  mensagem?: string,
): IntencaoCorrigirMovimento {
  if (!mensagem?.trim()) return intencao;

  const codigo = extrair_codigo_da_mensagem(mensagem) ?? intencao.referencia.codigo ?? null;
  const termo = codigo ? null : preferir_termo_referencia(mensagem, intencao.referencia.descricao);
  const descricaoBruta = codigo
    ? null
    : termo && termo !== "não especificado"
      ? termo
      : (intencao.referencia.descricao ?? null);

  return {
    ...intencao,
    referencia: {
      ...intencao.referencia,
      codigo,
      descricao: descricaoBruta,
    },
  };
}

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function rotulo_modalidade(modalidade: string): string {
  if (modalidade === "debito") return "débito";
  if (modalidade === "multiplo") return "múltiplo (crédito e débito)";
  return "crédito";
}

function rotulo_forma_pagamento(forma: string | null | undefined): string {
  if (!forma) return "";
  const mapa: Record<string, string> = {
    pix: "via Pix",
    transferencia: "via transferência",
    boleto: "via boleto",
    dinheiro: "em dinheiro",
    credito: "no crédito",
    debito: "no débito",
  };
  return mapa[forma] ? ` (${mapa[forma]})` : "";
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
      if (intencao.confirmado !== true) {
        const previa = await contexto.resolvedor.preparar_confirmacao_duplicata_movimento(
          contexto.usuarioId,
          intencao,
        );
        if (previa) {
          return montar_confirmacao_duplicata_lancamento(
            previa.descricao,
            previa.dataMovimento,
            previa.valor,
            previa.origemRotulo,
          );
        }
      }

      const entrada = await contexto.resolvedor.resolver_registrar_movimento(intencao, referenciaResolucao);
      const resultado = await contexto.motor.criar_movimento(entrada);
      const viaForma = rotulo_forma_pagamento(entrada.formaPagamento);

      if (contexto.memoria) {
        await aprender_habitos_apos_lancamento(contexto.memoria, contexto.usuarioId, entrada, {
          contaNome: intencao.conta_nome,
          cartaoNome: intencao.cartao_nome,
          categoriaNome: intencao.categoria_nome,
        });
      }

      let base: string;
      if (resultado.parcelas.length > 1) {
        const primeiraParcela = resultado.parcelas[0];
        base = `Compra de ${formatarMoeda(entrada.valor)} registrada em ${resultado.parcelas.length}x de ${formatarMoeda(
          primeiraParcela?.valor ?? "0",
        )} — "${entrada.descricao}"${viaForma}.`;
      } else if (resultado.movimentos.length === 2) {
        base = `Transferência de ${formatarMoeda(entrada.valor)} registrada com sucesso${viaForma}.`;
      } else {
        base = `${capitalizar(entrada.tipo)} de ${formatarMoeda(entrada.valor)} registrada em "${entrada.descricao}" (${entrada.dataMovimento})${viaForma}.`;
      }

      if (entrada.tipo === "despesa") {
        const alerta = await texto_alerta_orcamento_apos_despesa({
          usuarioId: contexto.usuarioId,
          dataAtual: contexto.dataAtual,
          categoriaId: entrada.categoriaId,
        });
        if (alerta) return `${base}\n\n${alerta}`;
      }
      return base;
    }

    case "CORRIGIR_MOVIMENTO": {
      const correcao = ajustar_referencia_correcao(intencao, contexto.mensagem);

      if (correcao.campos_alterados.status === "cancelado" && correcao.campos_alterados.confirmado !== true) {
        const previa = await contexto.resolvedor.preparar_confirmacao_exclusao_movimento(
          contexto.usuarioId,
          correcao.referencia,
        );
        return montar_confirmacao_exclusao_lancamento(
          previa.descricao,
          previa.dataMovimento,
          previa.valorTotal,
          previa.quantidade,
          previa.codigo,
        );
      }

      if (correcao.campos_alterados.status === "cancelado" && correcao.campos_alterados.confirmado === true) {
        const lote = await contexto.resolvedor.resolver_cancelar_movimentos(correcao, referenciaResolucao);
        for (const entrada of lote.entradas) {
          await contexto.motor.corrigir_movimento(entrada);
        }
        if (lote.entradas.length === 1) {
          return `Lançamento "${lote.descricao}" cancelado.`;
        }
        return `${lote.entradas.length} lançamentos de "${lote.descricao}" cancelados.`;
      }

      const entrada = await contexto.resolvedor.resolver_corrigir_movimento(correcao, referenciaResolucao);
      const movimentoAtualizado = await contexto.motor.corrigir_movimento(entrada);
      if (correcao.campos_alterados.parcelas != null) {
        return `Lançamento "${movimentoAtualizado.descricao}" atualizado — agora em ${correcao.campos_alterados.parcelas}x (total ${formatarMoeda(movimentoAtualizado.valor)}).`;
      }
      return `Lançamento "${movimentoAtualizado.descricao}" atualizado com sucesso.`;
    }

    case "CONSULTAR_VISAO": {
      const filtros = await contexto.resolvedor.resolver_consultar_visao(intencao, referenciaResolucao);
      const resultado = await contexto.relatorios.consultar_visao(intencao.tipo_visao, filtros, contexto.dataAtual);
      return montar_resposta_visao(resultado);
    }

    case "DEFINIR_ORCAMENTO": {
      const categoria = await contexto.resolvedor.resolver_categoria_nome(
        contexto.usuarioId,
        intencao.categoria_nome,
        "despesa",
      );
      await definir_orcamento({
        usuarioId: contexto.usuarioId,
        valorLimite: intencao.valor_limite,
        categoriaId: categoria?.id ?? null,
      });
      const rotulo = categoria?.nome ?? "geral (todas as despesas)";
      return `Orçamento definido: ${formatarMoeda(intencao.valor_limite)} por mês para ${rotulo}.`;
    }

    case "CONSULTAR_ORCAMENTO": {
      const categoria = await contexto.resolvedor.buscar_categoria_nome(
        contexto.usuarioId,
        intencao.categoria_nome,
      );
      const status = await listar_status_orcamentos(
        contexto.usuarioId,
        contexto.dataAtual,
        categoria?.id ?? null,
      );
      return formatar_status_orcamentos(status);
    }

    case "CRIAR_RECORRENCIA": {
      const categoria = await contexto.resolvedor.resolver_categoria_nome(
        contexto.usuarioId,
        intencao.categoria_nome ?? "Assinaturas",
        "despesa",
      );
      if (!categoria) {
        return "Não consegui definir a categoria da recorrência.";
      }
      const contaId = await contexto.resolvedor.resolver_conta_nome(
        contexto.usuarioId,
        intencao.conta_nome,
      );
      const cartaoId = await contexto.resolvedor.resolver_cartao_nome(
        contexto.usuarioId,
        intencao.cartao_nome,
      );
      if (!contaId && !cartaoId) {
        return "Para criar a recorrência, diga em qual conta ou cartão (ex.: Nubank).";
      }
      const criada = await criar_recorrencia({
        usuarioId: contexto.usuarioId,
        descricao: intencao.descricao,
        valor: intencao.valor,
        diaDoMes: intencao.dia_do_mes,
        tipo: intencao.tipo_movimento === "receita" ? "receita" : "despesa",
        categoriaId: categoria.id,
        contaId,
        cartaoId,
      });
      return `Recorrência "${criada.descricao}" de ${formatarMoeda(criada.valor)} todo dia ${criada.diaDoMes} criada.`;
    }

    case "LISTAR_RECORRENCIAS": {
      const lista = await listar_recorrencias(contexto.usuarioId);
      return formatar_lista_recorrencias(lista);
    }

    case "CANCELAR_RECORRENCIA": {
      const cancelada = await cancelar_recorrencia(contexto.usuarioId, intencao.descricao);
      if (!cancelada) {
        return `Não encontrei recorrência com "${intencao.descricao}".`;
      }
      return `Recorrência "${cancelada.descricao}" cancelada.`;
    }

    case "CRIAR_CONTA": {
      const eraPrimeiraConta = contexto.totalContas === 0;
      try {
        const conta = await contexto.resolvedor.resolver_criar_conta(intencao, referenciaResolucao);
        const confirmacao = `Conta "${conta.nome}" criada com saldo de ${formatarMoeda(conta.saldoAtual)} (${
          conta.perfil === "pj" ? "empresa" : "pessoal"
        }).`;

        if (eraPrimeiraConta) {
          return `${confirmacao} Quer cadastrar um cartão de crédito também, ou já pode começar a registrar seus gastos e receitas por aqui.`;
        }
        return confirmacao;
      } catch (erro) {
        if (!(erro instanceof ErroEntidadeJaExiste) || !intencao.nome || intencao.saldo_inicial == null) {
          throw erro;
        }
        const conta = await contexto.resolvedor.resolver_corrigir_conta(
          {
            intencao: "CORRIGIR_CONTA",
            conta_nome: intencao.nome,
            campos_alterados: { saldo_atual: intencao.saldo_inicial, perfil: intencao.perfil ?? null },
          },
          referenciaResolucao,
        );
        return `Conta "${conta.nome}" atualizada — saldo atual de ${formatarMoeda(conta.saldoAtual)} (${
          conta.perfil === "pj" ? "empresa" : "pessoal"
        }).`;
      }
    }

    case "CRIAR_CARTAO": {
      const eraPrimeiroCartao = contexto.totalCartoes === 0;
      const cartao = await contexto.resolvedor.resolver_criar_cartao(intencao, referenciaResolucao);
      const final4 = cartao.final4 ? ` Final •••• ${cartao.final4} salvo.` : "";
      const modalidade = rotulo_modalidade(cartao.modalidade);
      const confirmacao =
        cartao.modalidade === "debito"
          ? `Cartão "${cartao.nome}" criado (${modalidade}).${final4}`
          : `Cartão "${cartao.nome}" criado (${modalidade}) — limite de ${formatarMoeda(cartao.limite)}, fecha dia ${cartao.fechamento} e vence dia ${cartao.vencimento}.${final4}`;

      if (eraPrimeiroCartao) {
        return `${confirmacao} Já pode começar a registrar suas compras nesse cartão só me contando o que comprou.`;
      }
      return confirmacao;
    }

    case "CONSULTAR_DADOS_CARTAO": {
      const previa = await contexto.resolvedor.preparar_confirmacao_exclusao_cartao(
        contexto.usuarioId,
        intencao.cartao_nome,
      );
      return montar_pedido_senha_cartao(previa.nome);
    }

    case "CORRIGIR_CONTA": {
      if (intencao.campos_alterados.ativo === false && intencao.campos_alterados.confirmado !== true) {
        const previa = await contexto.resolvedor.preparar_confirmacao_exclusao_conta(
          contexto.usuarioId,
          intencao.conta_nome,
        );
        return montar_confirmacao_exclusao("conta", previa.nome, previa.totalLancamentos);
      }

      const conta = await contexto.resolvedor.resolver_corrigir_conta(intencao, referenciaResolucao);
      if (conta.ativo === false) {
        return `Conta "${conta.nome}" removida.`;
      }
      return `Conta "${conta.nome}" atualizada — saldo atual de ${formatarMoeda(conta.saldoAtual)} (${
        conta.perfil === "pj" ? "empresa" : "pessoal"
      }).`;
    }

    case "CORRIGIR_CARTAO": {
      if (intencao.campos_alterados.ativo === false && intencao.campos_alterados.confirmado !== true) {
        const previa = await contexto.resolvedor.preparar_confirmacao_exclusao_cartao(
          contexto.usuarioId,
          intencao.cartao_nome,
        );
        return montar_confirmacao_exclusao("cartão", previa.nome, previa.totalLancamentos);
      }

      const cartao = await contexto.resolvedor.resolver_corrigir_cartao(intencao, referenciaResolucao);
      if (cartao.ativo === false) {
        return `Cartão "${cartao.nome}" removido.`;
      }
      const final4 = cartao.final4 ? ` Final •••• ${cartao.final4}.` : "";
      const modalidade = rotulo_modalidade(cartao.modalidade);
      return `Cartão "${cartao.nome}" atualizado (${modalidade}) — limite de ${formatarMoeda(cartao.limite)}, fecha dia ${cartao.fechamento} e vence dia ${cartao.vencimento}.${final4}`;
    }

    case "SOLICITAR_INFORMACAO":
      return intencao.pergunta;

    case "MENU":
      return 'Digite "menu" ou "ajuda" a qualquer momento para ver os comandos disponíveis.';

    case "NAO_RECONHECIDA":
      return intencao.motivo || "Não entendi essa mensagem. Pode reformular?";
  }
}
