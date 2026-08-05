import type { IntencaoConsultarVisao, IntencaoDetectada } from "@lancai/tipos";
import { consulta_historico_detalhada } from "./consulta-historico-detalhada";
import { inicio_fim_mes_iso, somar_dias_iso_local } from "./datas-relativas";
import { inferir_origem_da_mensagem } from "./inferir-origem-movimento";
import type { ContextoInterpretacao } from "./prompt";

const ACAO_ESCRITA =
  /\b(corrige|corrigir|apague|apaga|apagar|cancela|cancelar|cadastr|exclui|excluir|muda o saldo)\b/i;

const VERBO_LANCAMENTO = /\b(gastei|paguei|comprei|recebi|ganhei|debitei)\b/i;
const PERGUNTA = /\b(quais|quanto|mostra|mostre|liste|listar|ver|veja|tiv[eé]|teve|resumo|extrato)\b/i;

const PEDIDO_HISTORICO =
  /\b(lan[cç]amentos?|extrato|movimenta[cç][oõ]es|gastos?|despesas?|gastei|paguei|resumo)\b/i;

const PEDIDO_SALDO =
  /\b(saldo|quanto\s+tenho|quanto\s+tem|quanto\s+resta|dinheiro\s+na\s+conta)\b/i;

const PEDIDO_MES =
  /\b(esse\s+m[eê]s|neste\s+m[eê]s|m[eê]s\s+atual|do\s+m[eê]s|no\s+m[eê]s)\b/i;

const ESTABELECIMENTO_SEM_PERIODO =
  /\b(uber|99|ifood|rappi|netflix|spotify|farm[aá]cia|mercado|posto)\b/i;

/**
 * Consultas óbvias sem LLM (economia de créditos).
 * Estabelecimento/categoria sem período explícito fica para a IA.
 */
export function interpretar_consulta_rapida(
  mensagem: string,
  contexto: ContextoInterpretacao,
): IntencaoDetectada | null {
  const texto = mensagem.trim();
  if (!texto || ACAO_ESCRITA.test(texto)) return null;
  if (VERBO_LANCAMENTO.test(texto) && !PERGUNTA.test(texto)) return null;

  const lower = texto.toLocaleLowerCase("pt-BR");

  if (PEDIDO_SALDO.test(texto) && !/\b(cart[aã]o|limite|fatura)\b/i.test(texto)) {
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

  // "quanto gastei de uber?" sem dia/mês → IA (precisa descricao)
  if (ESTABELECIMENTO_SEM_PERIODO.test(lower) && !tem_periodo_explicito(lower)) {
    return null;
  }

  const periodo = resolver_periodo_consulta(lower, contexto.dataAtual);
  if (!periodo) return null;

  const origem = inferir_origem_da_mensagem(texto, contexto);
  const intencao: IntencaoConsultarVisao = {
    intencao: "CONSULTAR_VISAO",
    tipo_visao: "historico",
    detalhado: consulta_historico_detalhada(texto),
    filtros: {
      periodo,
      conta_nome: origem.conta_nome ?? null,
      cartao_nome: origem.cartao_nome ?? null,
    },
  };
  return intencao;
}

function tem_periodo_explicito(texto: string): boolean {
  return (
    PEDIDO_MES.test(texto) ||
    /\b(hoje|ontem|anteontem|\d{1,2}\/\d{1,2})\b/.test(texto)
  );
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

  if (/^(quais|mostra|mostre|liste|ver|veja)\b/.test(texto) && PEDIDO_HISTORICO.test(texto)) {
    return { de: dataAtual, ate: dataAtual };
  }

  // "quanto gastei?" sem período → mês atual (retrieve-first)
  if (/^quanto\s+(gastei|paguei|despendi)\??$/i.test(texto.trim())) {
    return inicio_fim_mes_iso(dataAtual);
  }

  return null;
}
