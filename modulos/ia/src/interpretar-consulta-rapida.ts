import type { IntencaoConsultarVisao, IntencaoDetectada } from "@lancai/tipos";
import { somar_dias_iso_local } from "./datas-relativas";
import { inferir_origem_da_mensagem } from "./inferir-origem-movimento";
import type { ContextoInterpretacao } from "./prompt";

const ACAO_ESCRITA =
  /\b(corrige|corrigir|apague|apaga|apagar|cancela|cancelar|cadastr|exclui|excluir|muda o saldo)\b/i;

const VERBO_LANCAMENTO = /\b(gastei|paguei|comprei|recebi|ganhei|debitei)\b/i;
const PERGUNTA = /\b(quais|quanto|mostra|mostre|liste|listar|ver|veja|tiv[eé]|teve)\b/i;

const PEDIDO_HISTORICO =
  /\b(lan[cç]amentos?|extrato|movimenta[cç][oõ]es|gastos?|despesas?|gastei|paguei)\b/i;

const PEDIDO_SALDO =
  /\b(saldo|quanto\s+tenho|quanto\s+tem|quanto\s+resta|dinheiro\s+na\s+conta)\b/i;

/**
 * Só consultas muito óbvias com dia explícito ou saldo — o resto fica com a IA
 * (estabelecimento, categoria, "esse mês", etc.).
 */
export function interpretar_consulta_rapida(
  mensagem: string,
  contexto: ContextoInterpretacao,
): IntencaoDetectada | null {
  const texto = mensagem.trim();
  if (!texto || ACAO_ESCRITA.test(texto)) return null;
  if (VERBO_LANCAMENTO.test(texto) && !PERGUNTA.test(texto)) return null;

  const lower = texto.toLocaleLowerCase("pt-BR");

  if (PEDIDO_HISTORICO.test(texto) && (PERGUNTA.test(texto) || /\b(hoje|ontem|anteontem|\d{1,2}\/\d{1,2})\b/.test(lower))) {
    const data = resolver_data_consulta(lower, contexto.dataAtual);
    if (!data) return null;

    const origem = inferir_origem_da_mensagem(texto, contexto);
    const intencao: IntencaoConsultarVisao = {
      intencao: "CONSULTAR_VISAO",
      tipo_visao: "historico",
      filtros: {
        periodo: { de: data, ate: data },
        conta_nome: origem.conta_nome ?? null,
        cartao_nome: origem.cartao_nome ?? null,
      },
    };
    return intencao;
  }

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

  return null;
}

function resolver_data_consulta(texto: string, dataAtual: string): string | null {
  if (/\banteontem\b/.test(texto)) return somar_dias_iso_local(dataAtual, -2);
  if (/\bontem\b/.test(texto)) return somar_dias_iso_local(dataAtual, -1);
  if (/\bhoje\b/.test(texto)) return dataAtual;

  const dataBr = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/.exec(texto);
  if (dataBr) {
    const dia = dataBr[1]!.padStart(2, "0");
    const mes = dataBr[2]!.padStart(2, "0");
    const ano = dataBr[3] ?? dataAtual.slice(0, 4);
    return `${ano}-${mes}-${dia}`;
  }

  if (/^(quais|mostra|mostre|liste|ver|veja)\b/.test(texto) && PEDIDO_HISTORICO.test(texto)) {
    return dataAtual;
  }

  return null;
}
