import type { IntencaoDetectada } from "@lancai/tipos";
import { extrair_codigo_da_mensagem } from "./codigo-movimento";
import { extrair_termo_referencia_mensagem } from "./extrair-termo-referencia";
import { somar_dias_iso_local } from "./datas-relativas";

const VERBO_CANCELAR =
  /\b(apague|apaga|apagar|exclua|exclui|excluir|cancele|cancela|cancelar|remova|remove|remover|delete|deletar)\b/i;
const FORA =
  /\b(corrige|corrigir|altera|muda|cadastr|mostra|quanto|saldo|limite|menu|ajuda)\b/i;

/**
 * Atalho: "cancela o #a1b2c3d4" ou "apague o lançamento de farmacia de hoje"
 * sem latência/falha de IA.
 */
export function interpretar_correcao_rapida(
  mensagem: string,
  dataAtual: string,
): IntencaoDetectada | null {
  const texto = mensagem.trim();
  if (!texto || FORA.test(texto) || !VERBO_CANCELAR.test(texto)) return null;

  const codigo = extrair_codigo_da_mensagem(texto);
  if (codigo) {
    return {
      intencao: "CORRIGIR_MOVIMENTO",
      referencia: { codigo, descricao: null, data_movimento: null },
      campos_alterados: { status: "cancelado", confirmado: false },
    };
  }

  const descricao = extrair_termo_referencia_mensagem(texto);
  if (!descricao) return null;

  let data_movimento: string | null = null;
  const lower = texto.toLocaleLowerCase("pt-BR");
  if (/\banteontem\b/.test(lower)) data_movimento = somar_dias_iso_local(dataAtual, -2);
  else if (/\bontem\b/.test(lower)) data_movimento = somar_dias_iso_local(dataAtual, -1);
  else if (/\bhoje\b/.test(lower)) data_movimento = dataAtual;
  else {
    const dataBr = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/.exec(texto);
    if (dataBr) {
      const dia = dataBr[1]!.padStart(2, "0");
      const mes = dataBr[2]!.padStart(2, "0");
      const ano = dataBr[3] ?? dataAtual.slice(0, 4);
      data_movimento = `${ano}-${mes}-${dia}`;
    }
  }

  return {
    intencao: "CORRIGIR_MOVIMENTO",
    referencia: { descricao, data_movimento, codigo: null },
    campos_alterados: { status: "cancelado", confirmado: false },
  };
}
