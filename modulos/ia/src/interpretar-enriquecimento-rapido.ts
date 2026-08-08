import type { IntencaoDetectada } from "@lancai/tipos";
import { extrair_codigo_da_mensagem } from "./codigo-movimento";
import { limpar_termo_descricao, enxugar_descricao_lancamento } from "./normalizar-descricao";
import { somar_dias_iso_local } from "./datas-relativas";

const IGNORAR =
  /\b(?:n[aã]o\s+considera|n[aã]o\s+considere|esconde|esconder|ignora|ignore|ocultar|oculta)\b/i;
const NOS_RELATORIOS =
  /\b(?:nos?\s+relat[oó]rios|dos?\s+relat[oó]rios|dos?\s+totais|nas?\s+contas|do\s+relat[oó]rio)\b/i;
const TAG =
  /\b(?:marca(?:r)?(?:\s+como)?|tag|etiqueta)\b/i;

function data_da_mensagem(texto: string, dataAtual: string): string | null {
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

function limpar_referencia(bruto: string): string | null {
  const limpo = limpar_termo_descricao(
    bruto
      .replace(/\b(?:esse|essa|este|esta|isso|aquilo)\b/gi, " ")
      .replace(/\b(?:lan[cç]amentos?|despesas?|compras?|gastos?)\b/gi, " ")
      .replace(/\b(?:nos?|dos?|nas?|das?)\s+(?:relat[oó]rios?|totais|contas)\b/gi, " "),
  );
  if (!limpo || limpo.length < 2) return null;
  return enxugar_descricao_lancamento(limpo);
}

function extrair_referencia_ignorar(
  texto: string,
  dataAtual: string,
): { codigo: string | null; descricao: string | null; data_movimento: string | null } {
  const codigo = extrair_codigo_da_mensagem(texto);
  if (codigo) {
    return { codigo, descricao: null, data_movimento: null };
  }

  const comDe =
    /\b(?:n[aã]o\s+consider[ae]|esconde(?:r)?|ignor[ae]|ocultar?)\b(?:\s+(?:o|a|os|as))?(?:\s+(?:lan[cç]amentos?|despesas?|compras?|gastos?))?(?:\s+(?:de|do|da))?\s+(.+?)\s+(?:nos?|dos?|nas?|das?)\s+(?:relat[oó]rios?|totais|contas)\b/i.exec(
      texto,
    );
  if (comDe?.[1]) {
    const descricao = limpar_referencia(comDe[1]);
    return {
      codigo: null,
      descricao,
      data_movimento: data_da_mensagem(texto, dataAtual),
    };
  }

  // "não considera esse nos relatórios" — sem nome; o resolvedor pega o mais recente.
  return {
    codigo: null,
    descricao: null,
    data_movimento: data_da_mensagem(texto, dataAtual),
  };
}

function extrair_tag_e_referencia(
  texto: string,
): { tag: string; descricao: string | null; codigo: string | null } | null {
  const codigo = extrair_codigo_da_mensagem(texto);

  // "tag projeto Itália no ifood" / "marca como projeto Itália o ifood"
  const padraoTagNo =
    /\b(?:tag|etiqueta|marca(?:r)?(?:\s+como)?)\s+(.+?)\s+(?:no|na|em)\s+(.+?)(?:\s*[.!]?\s*$)/i.exec(
      texto,
    );
  if (padraoTagNo?.[1] && padraoTagNo[2]) {
    const tag = limpar_termo_descricao(padraoTagNo[1]);
    const descricao = codigo ? null : limpar_referencia(padraoTagNo[2]);
    if (!tag) return null;
    return { tag, descricao, codigo };
  }

  // "marca o ifood como projeto Itália"
  const padraoComo =
    /\bmarca(?:r)?(?:\s+(?:o|a|os|as))?\s+(.+?)\s+como\s+(.+?)(?:\s*[.!]?\s*$)/i.exec(texto);
  if (padraoComo?.[1] && padraoComo?.[2]) {
    const descricao = codigo ? null : limpar_referencia(padraoComo[1]);
    const tag = limpar_termo_descricao(padraoComo[2]);
    if (!tag) return null;
    return { tag, descricao, codigo };
  }

  return null;
}

/**
 * Atalho F5: esconder dos relatórios / marcar tag — sem latência de IA.
 * Fecha o caminho anunciado na recusa de exclusão em conta sincronizada.
 */
export function interpretar_enriquecimento_rapido(
  mensagem: string,
  dataAtual: string,
): IntencaoDetectada | null {
  const texto = mensagem.trim();
  if (!texto) return null;

  if (IGNORAR.test(texto) && NOS_RELATORIOS.test(texto)) {
    const referencia = extrair_referencia_ignorar(texto, dataAtual);
    return {
      intencao: "CORRIGIR_MOVIMENTO",
      referencia: {
        codigo: referencia.codigo,
        descricao: referencia.descricao,
        data_movimento: referencia.data_movimento,
      },
      campos_alterados: { ignorado_em_relatorio: true },
    };
  }

  if (TAG.test(texto)) {
    const capturado = extrair_tag_e_referencia(texto);
    if (!capturado) return null;
    return {
      intencao: "CORRIGIR_MOVIMENTO",
      referencia: {
        codigo: capturado.codigo,
        descricao: capturado.descricao,
        data_movimento: null,
      },
      campos_alterados: { tags: [capturado.tag] },
    };
  }

  return null;
}
