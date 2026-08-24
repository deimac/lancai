import { LIMITE_ITENS_HISTORICO } from "@lancai/tipos";
import type { IntencaoConsultarVisao, IntencaoDetectada, Perfil, TipoVisao } from "@lancai/tipos";
import { consulta_historico_detalhada } from "./consulta-historico-detalhada";
import { aplicar_escopo_fluxo_na_consulta } from "./escopo-fluxo-consulta";
import { eh_pedido_fluxo_cruzado } from "./pedido-fluxo-cruzado";
import { inicio_fim_mes_iso, periodo_historico_completo, somar_dias_iso_local } from "./datas-relativas";
import {
  categoria_do_contexto,
  extrair_descricao_consulta_historico,
  extrair_estabelecimento_conhecido,
} from "./extrair-descricao-consulta";
import { inferir_origem_da_mensagem } from "./inferir-origem-movimento";
import { inferir_perfil_da_mensagem } from "./normalizar-intencao-movimento";
import type { ContextoInterpretacao } from "./prompt";

const ACAO_ESCRITA =
  /\b(corrige|corrigir|apague|apaga|apagar|cancela|cancelar|cadastr|exclui|excluir|muda o saldo)\b/i;

const VERBO_LANCAMENTO = /\b(gastei|paguei|comprei|recebi|ganhei|debitei)\b/i;
const PERGUNTA = /\b(quais|quanto|mostra|mostre|liste|listar|ver|veja|tiv[eé]|teve|resumo|extrato|como)\b/i;

const PEDIDO_PARCELAMENTOS =
  /\b(parcelamentos?|compras?\s+parcelad|quanto\s+falta\s+(?:pagar|das?\s+parcelas?)|parcelas?\s+(?:abertas?|restantes?))\b/i;

const PEDIDO_FUTURO =
  /\b(comprometido|compromissos?|lan[cç]amentos?\s+futuros?|vencimentos?\s+futuros?|a\s+pagar\s+at[eé]|quanto\s+(?:tenho\s+)?compromet|previsto\s+at[eé])\b/i;

const PEDIDO_EVOLUCAO =
  /\b(evolu[cç][aã]o|últimos?\s+\d*\s*meses|ultimos?\s+\d*\s*meses|ao\s+longo\s+dos?\s+meses|como\s+est[aã]o\s+(?:as\s+)?(?:minhas\s+)?finan)/i;

/**
 * Follow-up após um total: "detalhado", "mostra detalhado",
 * "faça o detalhamento dos lançamentos", etc.
 */
const PEDIDO_SO_DETALHE =
  /^(?:me\s+)?(?:(?:mostra|mostre|ver|veja|liste|listar|quero|fa[cç]a|faz|manda|d[aá])\s+)?(?:o\s+)?(?:detalhad[oa]s?|detalhamento|detalhe|detalha|um\s+a\s+um|item\s+a\s+item)(?:\s+(?:dos?\s+|das?\s+|de\s+|os\s+|as\s+)?(?:lan[cç]amentos?|gastos?|despesas?|itens?|extrato))?\??\.?$/i;

/** Pedido de detalhe embutido sem redefinir período ("faz o detalhamento…"). */
const PEDIDO_DETALHE_FOLLOWUP =
  /\b(detalhad[oa]s?|detalhamento|detalhe|detalha|um\s+a\s+um|item\s+a\s+item)\b/i;

/** Follow-up de paginação do extrato: "mais", "continuar", "próximos". */
const PEDIDO_MAIS_HISTORICO =
  /^(?:(?:mostra|mostre|ver|veja|liste|listar|quero)\s+)?(?:mais|continuar|continua|pr[oó]ximos?)\??\.?$/i;

const PEDIDO_HISTORICO =
  /\b(lan[cç]amentos?|extrato|movimenta[cç][oõ]es|gastos?|despesas?|gastei|paguei|recebi|ganhei|receitas?|entrou|entradas?|resumo)\b/i;

const PEDIDO_SALDO =
  /\b(saldo|quanto\s+tenho|quanto\s+tem|quanto\s+resta|dinheiro\s+na\s+conta)\b/i;

const PEDIDO_MES =
  /\b((?:n?este|esse)\s+m[eê]s|m[eê]s\s+atual|do\s+m[eê]s|no\s+m[eê]s)\b/i;

const PEDIDO_TODOS = /\btod[oa]s?\b/i;

/**
 * Reaproveita a última consulta (histórico ou fluxo cruzado) quando o usuário
 * pede o detalhe sem mudar o período (ex.: após "quanto gastei hoje?" → "detalhamento").
 */
export function interpretar_pedido_detalhe_historico(
  mensagem: string,
  ultimaIntencaoIa: IntencaoDetectada | null | undefined,
): IntencaoDetectada | null {
  const texto = mensagem.trim();
  if (!texto) return null;
  if (!ultimaIntencaoIa || ultimaIntencaoIa.intencao !== "CONSULTAR_VISAO") return null;
  if (ultimaIntencaoIa.tipo_visao !== "historico" && ultimaIntencaoIa.tipo_visao !== "fluxo") {
    return null;
  }

  const soDetalhe = PEDIDO_SO_DETALHE.test(texto);
  const followup =
    !soDetalhe &&
    PEDIDO_DETALHE_FOLLOWUP.test(texto) &&
    !/\b(hoje|ontem|anteontem|esse\s+m[eê]s|neste\s+m[eê]s|\d{1,2}\/\d{1,2})\b/i.test(texto) &&
    !/\bquanto\s+(gastei|paguei)\b/i.test(texto) &&
    !extrair_estabelecimento_conhecido(texto);

  if (!soDetalhe && !followup) return null;

  return {
    ...ultimaIntencaoIa,
    detalhado: true,
    deslocamento: 0,
  };
}

/**
 * Avança a página do extrato quando o usuário diz "mais" / "continuar".
 */
export function interpretar_pedido_mais_historico(
  mensagem: string,
  ultimaIntencaoIa: IntencaoDetectada | null | undefined,
): IntencaoDetectada | null {
  const texto = mensagem.trim();
  if (!texto || !PEDIDO_MAIS_HISTORICO.test(texto)) return null;
  if (!ultimaIntencaoIa || ultimaIntencaoIa.intencao !== "CONSULTAR_VISAO") return null;
  if (ultimaIntencaoIa.tipo_visao !== "historico") return null;

  const deslocamentoAtual = ultimaIntencaoIa.deslocamento ?? 0;
  return {
    ...ultimaIntencaoIa,
    detalhado: true,
    deslocamento: deslocamentoAtual + LIMITE_ITENS_HISTORICO,
  };
}

function montar_consulta(
  tipo: TipoVisao,
  texto: string,
  contexto: ContextoInterpretacao,
  opcoes: { perfil?: Perfil | null; forcarPerfilNulo?: boolean } = {},
): IntencaoConsultarVisao {
  const origem = inferir_origem_da_mensagem(texto, contexto);
  const perfil = opcoes.forcarPerfilNulo
    ? null
    : (opcoes.perfil !== undefined ? opcoes.perfil : inferir_perfil_da_mensagem(texto));
  return {
    intencao: "CONSULTAR_VISAO",
    tipo_visao: tipo,
    filtros: {
      conta_nome: origem.conta_nome ?? null,
      cartao_nome: origem.cartao_nome ?? null,
      perfil,
    },
  };
}

/**
 * Visões nomeadas (fluxo, futuro, evolução, parcelamentos) — período padrão
 * fica a cargo do ModuloRelatorios quando omitido.
 */
function interpretar_visao_nomeada(
  texto: string,
  contexto: ContextoInterpretacao,
): IntencaoConsultarVisao | null {
  if (
    !PERGUNTA.test(texto) &&
    !PEDIDO_PARCELAMENTOS.test(texto) &&
    !PEDIDO_FUTURO.test(texto) &&
    !PEDIDO_EVOLUCAO.test(texto) &&
    !eh_pedido_fluxo_cruzado(texto)
  ) {
    return null;
  }

  // Fluxo cruzado antes de histórico: "gastos pessoais na conta da empresa".
  if (eh_pedido_fluxo_cruzado(texto)) {
    const consulta = montar_consulta("fluxo", texto, contexto, { forcarPerfilNulo: true });
    const periodo = resolver_periodo_consulta(texto.toLocaleLowerCase("pt-BR"), contexto.dataAtual);
    if (periodo) {
      consulta.filtros = { ...consulta.filtros, periodo };
    }
    return aplicar_escopo_fluxo_na_consulta(consulta, texto);
  }

  if (PEDIDO_EVOLUCAO.test(texto)) {
    return montar_consulta("evolucao", texto, contexto);
  }

  if (PEDIDO_FUTURO.test(texto)) {
    return montar_consulta("futuro", texto, contexto);
  }

  if (PEDIDO_PARCELAMENTOS.test(texto)) {
    return montar_consulta("parcelamentos", texto, contexto);
  }

  return null;
}

/**
 * Consultas óbvias sem LLM (economia de créditos).
 * Estabelecimento ou texto após "lançamentos de X" → histórico + descricao.
 * Categoria cadastrada sem período continua na IA ("quanto gastei com Transporte?").
 */
export function interpretar_consulta_rapida(
  mensagem: string,
  contexto: ContextoInterpretacao,
): IntencaoDetectada | null {
  const texto = mensagem.trim();
  if (!texto || ACAO_ESCRITA.test(texto)) return null;
  if (VERBO_LANCAMENTO.test(texto) && !PERGUNTA.test(texto)) return null;

  const lower = texto.toLocaleLowerCase("pt-BR");

  const visaoNomeada = interpretar_visao_nomeada(texto, contexto);
  if (visaoNomeada) return visaoNomeada;

  if (
    PEDIDO_SALDO.test(texto) &&
    !/\b(cart[aã]o|limite|fatura|comprometido|compromissos?)\b/i.test(texto)
  ) {
    const origem = inferir_origem_da_mensagem(texto, contexto);
    return {
      intencao: "CONSULTAR_VISAO",
      tipo_visao: "saldos",
      filtros: {
        conta_nome: origem.conta_nome ?? null,
      },
    };
  }

  if (!PEDIDO_HISTORICO.test(texto) || !PERGUNTA.test(texto)) return null;

  const termo = extrair_descricao_consulta_historico(texto, contexto);
  const categoriaNome = termo && !extrair_estabelecimento_conhecido(texto)
    ? categoria_do_contexto(termo, contexto)
    : null;
  const descricao = termo && !categoriaNome ? termo : undefined;
  const pedeLista = consulta_historico_detalhada(texto);
  const periodo =
    resolver_periodo_consulta(lower, contexto.dataAtual) ??
    (PEDIDO_TODOS.test(texto) || (pedeLista && Boolean(descricao || categoriaNome))
      ? periodo_historico_completo(contexto.dataAtual)
      : descricao || categoriaNome
        ? inicio_fim_mes_iso(contexto.dataAtual)
        : pedeLista
          ? { de: contexto.dataAtual, ate: contexto.dataAtual }
          : null);
  if (!periodo) return null;

  const origem = inferir_origem_da_mensagem(texto, contexto);
  const intencao: IntencaoConsultarVisao = {
    intencao: "CONSULTAR_VISAO",
    tipo_visao: "historico",
    detalhado: pedeLista,
    filtros: {
      periodo,
      conta_nome: origem.conta_nome ?? null,
      cartao_nome: origem.cartao_nome ?? null,
      ...(descricao ? { descricao } : {}),
      ...(categoriaNome ? { categoria_nome: categoriaNome } : {}),
    },
  };
  return aplicar_escopo_fluxo_na_consulta(intencao, texto);
}

/** `null` no periodo = mês atual no ModuloRelatorios; objeto = dia ou intervalo. */
function resolver_periodo_consulta(
  texto: string,
  dataAtual: string,
): { de: string; ate: string } | null {
  if (PEDIDO_MES.test(texto) || /\bresumo\b/.test(texto)) {
    // Periodo vazio no schema = mês atual; aqui devolvemos explícito para atalho claro.
    return inicio_fim_mes_iso(dataAtual);
  }

  if (/\banteontem\b/.test(texto)) {
    const d = somar_dias_iso_local(dataAtual, -2);
    return { de: d, ate: d };
  }
  if (/\bontem\b/.test(texto)) {
    const d = somar_dias_iso_local(dataAtual, -1);
    return { de: d, ate: d };
  }
  if (/\bhoje\b/.test(texto)) {
    return { de: dataAtual, ate: dataAtual };
  }

  const dataBr = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/.exec(texto);
  if (dataBr) {
    const dia = dataBr[1]!.padStart(2, "0");
    const mes = dataBr[2]!.padStart(2, "0");
    const ano = dataBr[3] ?? dataAtual.slice(0, 4);
    const d = `${ano}-${mes}-${dia}`;
    return { de: d, ate: d };
  }

  if (PEDIDO_TODOS.test(texto) && PEDIDO_HISTORICO.test(texto)) {
    return periodo_historico_completo(dataAtual);
  }

  // "quanto gastei/recebi?" sem período → mês atual (retrieve-first)
  if (/^quanto\s+(gastei|paguei|despendi|recebi|ganhei|entrou)\??$/i.test(texto.trim())) {
    return inicio_fim_mes_iso(dataAtual);
  }

  return null;
}
