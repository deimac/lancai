import {
  formatarMoeda,
  formatarQuandoFato,
  separar_correcao_por_grupo,
} from "@lancai/tipos";
import type {
  EntradaCorrigirMovimento,
  IntencaoCorrigirMovimento,
  IntencaoDetectada,
  TipoFonte,
} from "@lancai/tipos";
import { CATEGORIA_NAO_CLASSIFICADO, type Movimento } from "@lancai/banco";
import type { Memoria, ServicoConhecimento, SugeridorCategoria } from "@lancai/conhecimento";
import type { MotorFinanceiro } from "@lancai/financeiro";
import {
  ErroEntidadeJaExiste,
  ErroReferenciaNaoEncontrada,
  consulta_historico_detalhada,
  escopo_dos_tipos,
  extrair_codigo_da_mensagem,
  mascara_final4_do_payload,
  preferir_termo_referencia,
  type ResolvedorIntencao,
} from "@lancai/ia";
import type { ModuloRelatorios } from "@lancai/relatorios";
import {
  montar_confirmacao_duplicata_lancamento,
  montar_confirmacao_exclusao,
  montar_confirmacao_exclusao_lancamento,
  montar_recusa_exclusao_protegida,
} from "./montar-confirmacao-exclusao";
import {
  montar_oferta_virar_regra,
  texto_regra_criada,
  texto_regra_ja_existia,
  texto_regra_recusada,
} from "./montar-oferta-virar-regra";
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
  workspaceId: string;
  /** Canal deste turno. Vira a `fonte` dos lançamentos criados. */
  fonte: TipoFonte;
  resolvedor: ResolvedorIntencao;
  motor: MotorFinanceiro;
  conhecimento: ServicoConhecimento;
  /** Quando presente, classifica (regra → IA) lançamentos sem categoria explícita. */
  sugeridorCategoria?: SugeridorCategoria;
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

/**
 * Uma frase como "corrige o combustível pra 210 e joga em Transporte" mistura
 * Fato e Conhecimento. Cada metade vai ao componente com autoridade sobre ela:
 * o Core cuida de valor, data, conta e status; o ServicoConhecimento cuida de
 * categoria, descrição, perfil, tags e observações.
 *
 * É tudo ou nada. Se o Fato for imutável, o erro sobe e nada é aplicado — meia
 * correção aplicada em silêncio seria pior do que uma recusa explicando o que
 * dá para mudar.
 */
async function aplicar_correcao(
  contexto: ContextoResposta,
  entrada: EntradaCorrigirMovimento,
): Promise<Movimento> {
  const { fato, conhecimento } = separar_correcao_por_grupo(entrada);

  let atualizado: Movimento | undefined;
  if (fato) {
    atualizado = await contexto.motor.corrigir_fato_manual(fato);
  }
  if (conhecimento) {
    atualizado = await contexto.conhecimento.atualizar(conhecimento);
  }

  if (!atualizado) {
    throw new Error("Correção sem nenhum campo reconhecido de Fato ou de Conhecimento.");
  }
  return atualizado;
}

function ajustar_referencia_correcao(
  intencao: IntencaoCorrigirMovimento,
  mensagem?: string,
): IntencaoCorrigirMovimento {
  if (!mensagem?.trim()) return intencao;
  // Resposta numérica da desambiguação — não reinterpretar a mensagem como descrição.
  if (intencao.referencia.indice != null) return intencao;

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
  const referenciaResolucao = {
    usuarioId: contexto.usuarioId,
    criadoPor: contexto.criadoPor,
    workspaceId: contexto.workspaceId,
    fonte: contexto.fonte,
  };

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

      // Regras (e IA, se ligada) quando o usuário não classificou à mão.
      if (contexto.sugeridorCategoria) {
        for (const mov of resultado.movimentos) {
          try {
            await classificar_se_pendente(contexto, mov.id);
          } catch (erroClass) {
            const msg = erroClass instanceof Error ? erroClass.message : String(erroClass);
            console.warn(`[regras] falha ao classificar pós-chat (ignorada): ${msg.slice(0, 160)}`);
          }
        }
      }

      if (contexto.memoria) {
        try {
          await aprender_habitos_apos_lancamento(contexto.memoria, contexto.usuarioId, entrada, {
            contaNome: intencao.conta_nome,
            cartaoNome: intencao.cartao_nome,
            categoriaNome: intencao.categoria_nome,
          });
        } catch (erroHabito) {
          const msg = erroHabito instanceof Error ? erroHabito.message : String(erroHabito);
          console.warn(`[habitos] falha ao aprender (ignorada): ${msg.slice(0, 160)}`);
        }
      }

      const fato = resultado.movimentos[0];
      const dataFato = fato?.dataMovimento ?? entrada.dataMovimento;
      const quandoFato = dataFato ? formatarQuandoFato(dataFato, fato?.ocorridoEmInstante) : "";
      const quando = quandoFato ? ` (${quandoFato})` : "";

      let base: string;
      if (resultado.parcelas.length > 1) {
        const primeiraParcela = resultado.parcelas[0];
        base = `Compra de ${formatarMoeda(entrada.valor)} registrada em ${resultado.parcelas.length}x de ${formatarMoeda(
          primeiraParcela?.valor ?? "0",
        )} — "${entrada.descricao}"${quando}${viaForma}.`;
      } else if (resultado.movimentos.length === 2) {
        base = `Transferência de ${formatarMoeda(entrada.valor)} registrada com sucesso${quando}${viaForma}.`;
      } else {
        base = `${capitalizar(entrada.tipo)} de ${formatarMoeda(entrada.valor)} registrada em "${entrada.descricao}"${quando}${viaForma}.`;
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
        // Recusar antes de perguntar. Pedir confirmação de algo que será negado
        // em seguida é pior do que negar de saída.
        if (previa.protegidos.length > 0) {
          return montar_recusa_exclusao_protegida(previa.descricao, previa.protegidos);
        }
        return montar_confirmacao_exclusao_lancamento(
          previa.descricao,
          previa.dataMovimento,
          previa.valorTotal,
          previa.quantidade,
          previa.codigo,
          previa.itens,
        );
      }

      if (correcao.campos_alterados.status === "cancelado" && correcao.campos_alterados.confirmado === true) {
        const lote = await contexto.resolvedor.resolver_cancelar_movimentos(correcao, referenciaResolucao);
        for (const entrada of lote.entradas) {
          await aplicar_correcao(contexto, entrada);
        }
        if (lote.entradas.length === 1) {
          return `Lançamento "${lote.descricao}" cancelado.`;
        }
        return `${lote.entradas.length} lançamentos de "${lote.descricao}" cancelados.`;
      }

      const entrada = await contexto.resolvedor.resolver_corrigir_movimento(correcao, referenciaResolucao);
      const movimentoAtualizado = await aplicar_correcao(contexto, entrada);
      if (correcao.campos_alterados.parcelas != null) {
        return `Lançamento "${movimentoAtualizado.descricao}" atualizado — agora em ${correcao.campos_alterados.parcelas}x (total ${formatarMoeda(movimentoAtualizado.valor)}).`;
      }

      if (correcao.campos_alterados.ignorado_em_relatorio === true) {
        return `Pronto — "${movimentoAtualizado.descricao}" fica fora dos totais e relatórios. O histórico do extrato continua intacto.`;
      }
      if (correcao.campos_alterados.ignorado_em_relatorio === false) {
        return `"${movimentoAtualizado.descricao}" voltou a contar nos totais e relatórios.`;
      }
      if (correcao.campos_alterados.tags?.length) {
        return `Marquei "${movimentoAtualizado.descricao}" com: ${correcao.campos_alterados.tags.join(", ")}.`;
      }

      let base = `Lançamento "${movimentoAtualizado.descricao}" atualizado com sucesso.`;
      if (correcao.campos_alterados.categoria_nome) {
        await contexto.conhecimento.propagar_classificacao_da_serie(movimentoAtualizado.id);
        const iguais = await contexto.conhecimento.propagar_classificacao_de_iguais(
          movimentoAtualizado.id,
        );
        if (iguais > 0) {
          base = `Lançamento "${movimentoAtualizado.descricao}" atualizado. Apliquei a mesma categoria em ${iguais} lançamento${iguais === 1 ? "" : "s"} igual${iguais === 1 ? "" : "is"}.`;
        }
        const proposta = await contexto.conhecimento.propor_regra_de_movimento(movimentoAtualizado.id);
        if (proposta) {
          base = `${base}\n\n${montar_oferta_virar_regra(proposta)}`;
        }
      }
      return base;
    }

    case "CRIAR_REGRA_APRENDIZADO": {
      if (!intencao.confirmado) return texto_regra_recusada();
      if (!intencao.referencia) {
        return "Não consegui identificar o lançamento para criar a regra.";
      }

      const entrada = await contexto.resolvedor.resolver_corrigir_movimento(
        {
          intencao: "CORRIGIR_MOVIMENTO",
          referencia: intencao.referencia,
          campos_alterados: {},
        },
        referenciaResolucao,
      );
      const resultado = await contexto.conhecimento.criar_regra_a_partir_de_correcao(entrada.movimentoId);

      if (resultado.criada) return texto_regra_criada(resultado.proposta);
      if (resultado.motivo === "ja_existe" && resultado.proposta) {
        return texto_regra_ja_existia(resultado.proposta);
      }
      return "Não consegui extrair um trecho útil para virar regra.";
    }

    case "CONSULTAR_VISAO": {
      const filtros = await contexto.resolvedor.resolver_consultar_visao(intencao, referenciaResolucao);
      const deslocamento =
        intencao.tipo_visao === "historico" ? (intencao.deslocamento ?? 0) : 0;
      const resultado = await contexto.relatorios.consultar_visao(
        intencao.tipo_visao,
        filtros,
        contexto.dataAtual,
        { deslocamento },
      );
      const detalhado =
        intencao.tipo_visao === "historico"
          ? (intencao.detalhado ?? consulta_historico_detalhada(contexto.mensagem ?? ""))
          : true;
      const escopoFluxo =
        intencao.tipo_visao === "historico"
          ? escopo_dos_tipos(intencao.filtros.tipos)
          : "ambos";
      return montar_resposta_visao(resultado, { detalhado, escopoFluxo });
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
      if (intencao.valor == null) {
        return "Qual é o valor?";
      }
      if (intencao.dia_do_mes == null) {
        return "Em qual dia do mês?";
      }
      const categoria = await contexto.resolvedor.resolver_categoria_nome(
        contexto.usuarioId,
        intencao.categoria_nome ?? "Assinaturas",
        "despesa",
      );
      if (!categoria) {
        return "Não consegui definir a categoria da recorrência.";
      }
      // Nome inexistente = slot faltante (não erro técnico de referência).
      const resolver_origem_suave = async (
        nome: string | null | undefined,
        tipo: "conta" | "cartao",
      ): Promise<string | undefined> => {
        if (!nome?.trim()) return undefined;
        try {
          return tipo === "conta"
            ? await contexto.resolvedor.resolver_conta_nome(contexto.usuarioId, nome)
            : await contexto.resolvedor.resolver_cartao_nome(contexto.usuarioId, nome);
        } catch (erro) {
          if (erro instanceof ErroReferenciaNaoEncontrada) return undefined;
          throw erro;
        }
      };
      let contaId = await resolver_origem_suave(intencao.conta_nome, "conta");
      let cartaoId = await resolver_origem_suave(intencao.cartao_nome, "cartao");
      // Fallback cruzado só se o nome existir no outro tipo.
      if (!contaId && !cartaoId && intencao.conta_nome) {
        cartaoId = await resolver_origem_suave(intencao.conta_nome, "cartao");
      }
      if (!cartaoId && !contaId && intencao.cartao_nome) {
        contaId = await resolver_origem_suave(intencao.cartao_nome, "conta");
      }
      if (!contaId && !cartaoId) {
        return "Em qual conta ou cartão?";
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
      const mascara = mascara_final4_do_payload(cartao.dadosPlasticosCifrados);
      const final4 = mascara ? ` Final •••• ${mascara} salvo.` : "";
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
      const mascara = mascara_final4_do_payload(cartao.dadosPlasticosCifrados);
      const final4 = mascara ? ` Final •••• ${mascara}.` : "";
      const modalidade = rotulo_modalidade(cartao.modalidade);
      return `Cartão "${cartao.nome}" atualizado (${modalidade}) — limite de ${formatarMoeda(cartao.limite)}, fecha dia ${cartao.fechamento} e vence dia ${cartao.vencimento}.${final4}`;
    }

    case "SOLICITAR_INFORMACAO":
      return intencao.pergunta;

    case "MENU":
      return 'Digite "menu" ou "ajuda" a qualquer momento para ver os comandos disponíveis.';

    case "MENSAGEM_INFO":
      return intencao.motivo;

    case "NAO_RECONHECIDA":
      return intencao.motivo || "Não entendi essa mensagem. Pode reformular?";
  }
}

/**
 * Aplica regras (e IA) só quando o lançamento ainda está em “Não classificado”
 * e não foi marcado à mão pelo usuário.
 */
async function classificar_se_pendente(
  contexto: ContextoResposta,
  movimentoId: string,
): Promise<void> {
  if (!contexto.sugeridorCategoria) return;

  const { RepositorioConhecimentoDrizzle } = await import("@lancai/conhecimento");
  const repo = new RepositorioConhecimentoDrizzle();
  const atual = await repo.obterMovimento(movimentoId);
  if (!atual || atual.classificadoPor === "usuario") return;

  const categoria = await repo.obterCategoria(atual.categoriaId);
  const pendente =
    !categoria ||
    categoria.nome.toLocaleLowerCase("pt-BR") ===
      CATEGORIA_NAO_CLASSIFICADO.toLocaleLowerCase("pt-BR");
  if (!pendente) return;

  await contexto.conhecimento.classificar(movimentoId, contexto.sugeridorCategoria);
}
