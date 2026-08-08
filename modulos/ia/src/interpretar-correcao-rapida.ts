import type { IntencaoDetectada } from "@lancai/tipos";
import { extrair_codigo_da_mensagem } from "./codigo-movimento";
import { somar_dias_iso_local } from "./datas-relativas";
import { extrair_termo_referencia_mensagem } from "./extrair-termo-referencia";
import { enxugar_descricao_lancamento, limpar_termo_descricao } from "./normalizar-descricao";

const VERBO_CANCELAR =
  /\b(apague|apaga|apagar|exclua|exclui|excluir|cancele|cancela|cancelar|remova|remove|remover|delete|deletar)\b/i;

const VERBO_CORRIGIR =
  /\b(corrige|corrija|corrigir|altera|alterar|muda|mudar|atualiza|atualizar)\b/i;

const FORA_DO_CANCELAR =
  /\b(corrige|corrigir|altera|muda|cadastr|mostra|quanto|saldo|limite|menu|ajuda)\b/i;

function extrair_data_referencia(texto: string, dataAtual: string): string | null {
  const lower = texto.toLocaleLowerCase("pt-BR");
  if (/\banteontem\b/.test(lower)) return somar_dias_iso_local(dataAtual, -2);
  if (/\bontem\b/.test(lower)) return somar_dias_iso_local(dataAtual, -1);
  if (/\bhoje\b/.test(lower)) return dataAtual;

  const dataBr = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/.exec(texto);
  if (!dataBr) return null;
  const dia = dataBr[1]!.padStart(2, "0");
  const mes = dataBr[2]!.padStart(2, "0");
  const ano = dataBr[3] ?? dataAtual.slice(0, 4);
  return `${ano}-${mes}-${dia}`;
}

function parse_valor(bruto: string): number | null {
  const n = bruto.includes(",")
    ? Number(bruto.replace(/\./g, "").replace(",", "."))
    : Number(bruto.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function limpar_referencia_correcao(bruto: string): string | null {
  let termo = bruto
    .replace(/\b(?:valor|descri[cç][aã]o|nome)\b/gi, " ")
    .replace(/\b(?:lan[cç]amentos?|despesas?|compras?|gastos?)\b/gi, " ")
    .replace(/\b(?:de|do|da|dos|das)\s+(?:hoje|ontem|anteontem|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/gi, " ")
    .replace(/\b(?:hoje|ontem|anteontem)\b/gi, " ")
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ");
  termo = limpar_termo_descricao(termo);
  if (termo.length < 2) return null;
  return enxugar_descricao_lancamento(termo);
}

/**
 * "corrige o almoço para 20" / "muda a descrição do uber para Uber Trip".
 */
function interpretar_alteracao_campos(
  mensagem: string,
  dataAtual: string,
): IntencaoDetectada | null {
  const texto = mensagem.trim();
  if (!VERBO_CORRIGIR.test(texto) || VERBO_CANCELAR.test(texto)) return null;

  // Valor: "... para 20" / "para R$ 20,00" / "para 20 reais"
  const comValor =
    /\bpara\s+(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:[.,]\d{1,2})?)\s*(?:reais?)?\s*[.!]?\s*$/i.exec(
      texto,
    );

  if (comValor?.[1]) {
    const valor = parse_valor(comValor[1]);
    if (valor == null) return null;

    const antesPara = texto.slice(0, comValor.index).trim();
    const descricao =
      extrair_termo_referencia_mensagem(texto) ??
      limpar_referencia_correcao(
        antesPara.replace(VERBO_CORRIGIR, " ").replace(/^\s*(?:o|a|os|as)\s+/i, ""),
      );
    if (!descricao) return null;

    return {
      intencao: "CORRIGIR_MOVIMENTO",
      referencia: {
        descricao,
        data_movimento: extrair_data_referencia(texto, dataAtual),
        codigo: extrair_codigo_da_mensagem(texto),
      },
      campos_alterados: { valor },
    };
  }

  // Descrição explícita: "muda a descrição do uber para Uber Trip"
  const comDescExplicita =
    /\b(?:descri[cç][aã]o|nome)\s+(?:d[eo]s?\s+|da\s+)?(.+?)\s+para\s+(.+?)\s*[.!]?\s*$/i.exec(
      texto,
    );
  if (comDescExplicita?.[1] && comDescExplicita[2]) {
    const referencia = limpar_referencia_correcao(comDescExplicita[1]);
    const nova = enxugar_descricao_lancamento(comDescExplicita[2].trim());
    if (!referencia || !nova || nova.length < 2) return null;
    return {
      intencao: "CORRIGIR_MOVIMENTO",
      referencia: {
        descricao: referencia,
        data_movimento: extrair_data_referencia(texto, dataAtual),
        codigo: null,
      },
      campos_alterados: { descricao: nova },
    };
  }

  // Renomear: "muda o almoço para jantar" (sem número após "para")
  const comRename =
    /\b(?:corrige|corrija|corrigir|altera|alterar|muda|mudar|atualiza|atualizar)\b(?:\s+(?:o|a|os|as))?\s+(.+?)\s+para\s+([^\d].+?)\s*[.!]?\s*$/i.exec(
      texto,
    );
  if (comRename?.[1] && comRename[2]) {
    const referencia = limpar_referencia_correcao(comRename[1]);
    const nova = enxugar_descricao_lancamento(comRename[2].trim());
    if (!referencia || !nova || nova.length < 2) return null;
    if (normalizar_igual(referencia, nova)) return null;
    return {
      intencao: "CORRIGIR_MOVIMENTO",
      referencia: {
        descricao: referencia,
        data_movimento: extrair_data_referencia(texto, dataAtual),
        codigo: null,
      },
      campos_alterados: { descricao: nova },
    };
  }

  return null;
}

function normalizar_igual(a: string, b: string): boolean {
  return (
    a.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR") ===
    b.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR")
  );
}

/**
 * Atalhos sem IA:
 * - cancelar: "cancela o #a1b2c3d4" / "apague o lançamento de farmacia de hoje"
 * - corrigir: "corrige o almoço para 20" / "muda a descrição do uber para Uber Trip"
 */
export function interpretar_correcao_rapida(
  mensagem: string,
  dataAtual: string,
): IntencaoDetectada | null {
  const texto = mensagem.trim();
  if (!texto) return null;

  const alteracao = interpretar_alteracao_campos(texto, dataAtual);
  if (alteracao) return alteracao;

  if (FORA_DO_CANCELAR.test(texto) || !VERBO_CANCELAR.test(texto)) return null;

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

  return {
    intencao: "CORRIGIR_MOVIMENTO",
    referencia: {
      descricao,
      data_movimento: extrair_data_referencia(texto, dataAtual),
      codigo: null,
    },
    campos_alterados: { status: "cancelado", confirmado: false },
  };
}
