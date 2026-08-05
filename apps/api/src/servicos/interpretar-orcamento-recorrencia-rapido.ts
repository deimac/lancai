import type { IntencaoDetectada } from "@lancai/tipos";

const ACAO_ESCRITA_FORTE =
  /\b(corrige|corrigir|apague|apaga|cancela lançamento|exclui lançamento)\b/i;

/**
 * Atalhos zero-LLM para orçamento e recorrências.
 */
export function interpretar_orcamento_rapido(mensagem: string): IntencaoDetectada | null {
  const texto = mensagem.trim();
  if (!texto || ACAO_ESCRITA_FORTE.test(texto)) return null;
  const lower = texto.toLocaleLowerCase("pt-BR");

  if (
    /\b(como\s+est[aá]|status|mostra|mostre|ver|veja|consultar?)\b/.test(lower) &&
    /\bor[cç]amento\b/.test(lower)
  ) {
    const cat = extrair_categoria_orcamento(lower);
    return { intencao: "CONSULTAR_ORCAMENTO", categoria_nome: cat };
  }

  if (/\bor[cç]amento\b/.test(lower) && /\b(meu|meus)\b/.test(lower) && !extrair_valor(lower)) {
    return { intencao: "CONSULTAR_ORCAMENTO", categoria_nome: null };
  }

  const definir = lower.match(
    /\bor[cç]amento(?:\s+de|\s+para)?\s+([a-záàâãéêíóôõúç\s]{2,40}?)?\s*(?:de\s+)?(?:r\$\s*)?(\d+[.,]?\d*)/i,
  );
  if (definir) {
    const valor = Number(definir[2]!.replace(",", "."));
    if (!Number.isFinite(valor) || valor <= 0) return null;
    const catBruta = definir[1]?.trim();
    const categoria_nome =
      catBruta && !/^(de|para|mensal|geral)$/i.test(catBruta) ? catBruta : null;
    return { intencao: "DEFINIR_ORCAMENTO", valor_limite: valor, categoria_nome };
  }

  const definirAlt = lower.match(
    /(?:definir|criar|quero)\s+or[cç]amento(?:\s+de|\s+para)?\s+([a-záàâãéêíóôõúç\s]{2,40}?)?\s*(?:de\s+)?(?:r\$\s*)?(\d+[.,]?\d*)/i,
  );
  if (definirAlt) {
    const valor = Number(definirAlt[2]!.replace(",", "."));
    if (!Number.isFinite(valor) || valor <= 0) return null;
    const catBruta = definirAlt[1]?.trim();
    const categoria_nome =
      catBruta && !/^(de|para|mensal|geral)$/i.test(catBruta) ? catBruta : null;
    return { intencao: "DEFINIR_ORCAMENTO", valor_limite: valor, categoria_nome };
  }

  return null;
}

export function interpretar_recorrencia_rapida(mensagem: string): IntencaoDetectada | null {
  const texto = mensagem.trim();
  if (!texto) return null;
  const lower = texto.toLocaleLowerCase("pt-BR");

  if (/\b(listar|mostra|mostre|quais|minhas?)\b/.test(lower) && /\brecorr[eê]n/.test(lower)) {
    return { intencao: "LISTAR_RECORRENCIAS" };
  }

  if (/\b(cancelar|cancela|parar|desativar)\b/.test(lower) && /\brecorr[eê]n|assinatura\b/.test(lower)) {
    const desc = texto
      .replace(/\b(cancelar|cancela|parar|desativar)\b/gi, "")
      .replace(/\b(recorr[eê]ncia|assinatura|de|a|o)\b/gi, "")
      .trim();
    if (desc.length >= 2) {
      return { intencao: "CANCELAR_RECORRENCIA", descricao: desc };
    }
  }

  // "todo mês dia 10 Netflix 55" / "recorrente Netflix 55 dia 10"
  const m = lower.match(
    /(?:todo\s+m[eê]s|mensal(?:mente)?|recorrente)\s+(?:dia\s+)?(\d{1,2})?\s*(.+?)\s+(?:r\$\s*)?(\d+[.,]?\d*)(?:\s+dia\s+(\d{1,2}))?/i,
  );
  if (m) {
    const dia = Number(m[1] || m[4] || 1);
    const descricao = m[2]!.replace(/\bdia\s+\d{1,2}\b/i, "").trim();
    const valor = Number(m[3]!.replace(",", "."));
    if (descricao.length >= 2 && valor > 0 && dia >= 1 && dia <= 31) {
      return {
        intencao: "CRIAR_RECORRENCIA",
        descricao: capitalizar(descricao),
        valor,
        dia_do_mes: dia,
        tipo_movimento: "despesa",
      };
    }
  }

  return null;
}

function extrair_categoria_orcamento(lower: string): string | null {
  const m = lower.match(/or[cç]amento(?:\s+de|\s+para)?\s+([a-záàâãéêíóôõúç]+)/i);
  if (!m?.[1]) return null;
  if (/^(geral|mensal|meu|meus)$/i.test(m[1])) return null;
  return m[1];
}

function extrair_valor(texto: string): number | null {
  const m = texto.match(/(?:r\$\s*)?(\d+[.,]?\d*)/);
  if (!m) return null;
  const n = Number(m[1]!.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
