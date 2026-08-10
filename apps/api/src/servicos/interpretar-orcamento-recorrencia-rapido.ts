import type { IntencaoDetectada } from "@lancai/tipos";
import { extrair_dia_do_mes_mensagem, type ContextoInterpretacao } from "@lancai/ia";

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

export function interpretar_recorrencia_rapida(
  mensagem: string,
  contexto?: ContextoInterpretacao | null,
): IntencaoDetectada | null {
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

  // Resposta curta ao slot-filling (ex.: "55,90" / "hoje" / "10").
  if (contexto?.intencaoPendente?.intencao_pendente === "CRIAR_RECORRENCIA") {
    const parciais = contexto.intencaoPendente.dados_parciais ?? {};
    const valorJaConhecido = typeof parciais.valor === "number";
    const valorMsg = extrair_valor_ignorando_dia(lower);
    const diaMsg = extrair_dia_do_mes_mensagem(texto, contexto.dataAtual, {
      permitirNumeroIsolado: valorJaConhecido,
    });
    const origemMsg = extrair_origem_no_na(texto, contexto);
    const temSinal =
      valorMsg != null ||
      diaMsg != null ||
      Boolean(origemMsg.conta_nome || origemMsg.cartao_nome) ||
      texto.length <= 40;

    if (temSinal && (typeof parciais.descricao === "string" || valorMsg != null || diaMsg != null)) {
      return {
        intencao: "CRIAR_RECORRENCIA",
        descricao:
          typeof parciais.descricao === "string" && parciais.descricao.trim()
            ? String(parciais.descricao)
            : "Recorrência",
        valor: valorMsg ?? (typeof parciais.valor === "number" ? parciais.valor : null),
        dia_do_mes:
          diaMsg ??
          (typeof parciais.dia_do_mes === "number" ? parciais.dia_do_mes : null),
        tipo_movimento:
          parciais.tipo_movimento === "receita" ? "receita" : "despesa",
        categoria_nome:
          typeof parciais.categoria_nome === "string" ? parciais.categoria_nome : null,
        conta_nome:
          origemMsg.conta_nome ??
          (typeof parciais.conta_nome === "string" ? parciais.conta_nome : null),
        cartao_nome:
          origemMsg.cartao_nome ??
          (typeof parciais.cartao_nome === "string" ? parciais.cartao_nome : null),
      };
    }
  }

  // Completa: "todo mês dia 10 Netflix 55" (dia explícito antes da descrição).
  const comDiaAntes = lower.match(
    /(?:todo\s+m[eê]s|mensal(?:mente)?|recorrente)\s+dia\s+(\d{1,2})\s+(.+?)\s+(?:r\$\s*)?(\d+[.,]?\d*)\b/i,
  );
  if (comDiaAntes) {
    const criada = montar_recorrencia_completa(
      Number(comDiaAntes[1]),
      comDiaAntes[2]!,
      comDiaAntes[3]!,
      texto,
      contexto,
    );
    if (criada) return criada;
  }

  // Completa: "recorrente Netflix 55 dia 10"
  const comDiaDepois = lower.match(
    /(?:todo\s+m[eê]s|mensal(?:mente)?|recorrente)\s+(.+?)\s+(?:r\$\s*)?(\d+[.,]?\d*)\s+dia\s+(\d{1,2})\b/i,
  );
  if (comDiaDepois) {
    const criada = montar_recorrencia_completa(
      Number(comDiaDepois[3]),
      comDiaDepois[1]!,
      comDiaDepois[2]!,
      texto,
      contexto,
    );
    if (criada) return criada;
  }

  // Incompleta: "todo mês dia 10 Netflix no Nubank" (sem valor) → normalizador pergunta.
  if (/\b(?:todo\s+m[eê]s|mensal(?:mente)?|recorrente)\b/.test(lower)) {
    const m = lower.match(
      /(?:todo\s+m[eê]s|mensal(?:mente)?|recorrente)\s+(?:dia\s+(\d{1,2})\s+)?(.+)/i,
    );
    if (m?.[2]) {
      const diaBruto = m[1] ? Number(m[1]) : null;
      const dia =
        diaBruto != null && diaBruto >= 1 && diaBruto <= 31 ? diaBruto : null;
      const trecho = m[2]
        .replace(/\bdia\s+\d{1,2}\b/i, "")
        .replace(/(?:r\$\s*)?\d+[.,]?\d*/g, "")
        .trim();
      const { descricao, conta_nome, cartao_nome } = separar_descricao_e_origem(
        trecho,
        texto,
        contexto,
      );
      if (descricao.length >= 2) {
        return {
          intencao: "CRIAR_RECORRENCIA",
          descricao: capitalizar(descricao),
          valor: null,
          dia_do_mes: dia,
          tipo_movimento: "despesa",
          conta_nome,
          cartao_nome,
        };
      }
    }
  }

  return null;
}

function montar_recorrencia_completa(
  dia: number,
  trecho: string,
  valorBruto: string,
  texto: string,
  contexto?: ContextoInterpretacao | null,
): IntencaoDetectada | null {
  const valor = Number(valorBruto.replace(",", "."));
  const limpo = trecho.replace(/\bdia\s+\d{1,2}\b/i, "").trim();
  const { descricao, conta_nome, cartao_nome } = separar_descricao_e_origem(
    limpo,
    texto,
    contexto,
  );
  if (descricao.length < 2 || !(valor > 0) || dia < 1 || dia > 31) return null;
  return {
    intencao: "CRIAR_RECORRENCIA",
    descricao: capitalizar(descricao),
    valor,
    dia_do_mes: dia,
    tipo_movimento: "despesa",
    conta_nome,
    cartao_nome,
  };
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

function extrair_valor_ignorando_dia(texto: string): number | null {
  const limpo = texto
    .replace(/\bdia\s+\d{1,2}\b/gi, " ")
    .replace(/\b(?:hoje|hj)\b/gi, " ");
  return extrair_valor(limpo);
}

/** "Netflix no Nubank" → descrição + conta/cartão textual. */
function separar_descricao_e_origem(
  trechoLower: string,
  textoOriginal: string,
  contexto?: ContextoInterpretacao | null,
): { descricao: string; conta_nome: string | null; cartao_nome: string | null } {
  const origem = extrair_origem_no_na(textoOriginal, contexto);
  let descricao = trechoLower
    .replace(/\b(?:no|na|em)\s+[a-záàâãéêíóôõúç0-9][\wáàâãéêíóôõúç0-9\s.-]{1,40}$/i, "")
    .replace(/\b(?:cart[aã]o|conta|banco)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (descricao.length < 2 && trechoLower.trim().length >= 2) {
    descricao = trechoLower.trim();
  }

  return {
    descricao,
    conta_nome: origem.conta_nome,
    cartao_nome: origem.cartao_nome,
  };
}

function extrair_origem_no_na(
  texto: string,
  contexto?: ContextoInterpretacao | null,
): {
  conta_nome: string | null;
  cartao_nome: string | null;
} {
  const m = texto.match(/\b(?:no|na|em)\s+(?:cart[aã]o\s+)?([A-Za-zÁ-ú0-9][\wÁ-ú0-9 .-]{1,40})\s*$/i);
  if (!m?.[1]) return { conta_nome: null, cartao_nome: null };
  const nome = m[1].trim().replace(/\s+/g, " ");
  const nomeLower = nome.toLocaleLowerCase("pt-BR");
  const pediuCartao = /\bcart[aã]o\b/i.test(texto);

  const cartao = contexto?.cartoes.find((c) => c.nome.toLocaleLowerCase("pt-BR") === nomeLower
    || c.nome.toLocaleLowerCase("pt-BR").includes(nomeLower)
    || nomeLower.includes(c.nome.toLocaleLowerCase("pt-BR")));
  const conta = contexto?.contas.find((c) => c.nome.toLocaleLowerCase("pt-BR") === nomeLower
    || c.nome.toLocaleLowerCase("pt-BR").includes(nomeLower)
    || nomeLower.includes(c.nome.toLocaleLowerCase("pt-BR")));

  if (pediuCartao) {
    if (cartao) return { conta_nome: null, cartao_nome: cartao.nome };
    return { conta_nome: null, cartao_nome: capitalizar(nome) };
  }

  if (cartao) return { conta_nome: null, cartao_nome: cartao.nome };
  if (conta) return { conta_nome: conta.nome, cartao_nome: null };

  // Sem match no cadastro: tenta como cartão (assinaturas costumam ir no cartão).
  return { conta_nome: null, cartao_nome: capitalizar(nome) };
}

function capitalizar(texto: string): string {
  if (!texto) return texto;
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
