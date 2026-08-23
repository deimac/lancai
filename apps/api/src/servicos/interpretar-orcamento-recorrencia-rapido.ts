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

const CORRECAO_LANCAMENTO =
  /\b(corrige|corrigir|altera|alterar|muda|mudar|atualiza|atualizar)\b/i;

/** Sinal de criar recorrência — "mensal" sozinho é adjetivo (tarifa mensal), não ação. */
const SINAL_CRIAR_RECORRENCIA =
  /\b(?:todo\s+m[eê]s|mensalmente|recorrente)\b/i;

export function interpretar_recorrencia_rapida(
  mensagem: string,
  contexto?: ContextoInterpretacao | null,
): IntencaoDetectada | null {
  const texto = mensagem.trim();
  if (!texto) return null;
  const lower = texto.toLocaleLowerCase("pt-BR");

  // "alterar data … tarifa mensal para 15/08" é correção de lançamento, não recorrência.
  if (CORRECAO_LANCAMENTO.test(texto) && !/\brecorr[eê]n\b/i.test(lower)) {
    return null;
  }

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
    /(?:todo\s+m[eê]s|mensalmente|recorrente)\s+dia\s+(\d{1,2})\s+(.+?)\s+(?:r\$\s*)?(\d+[.,]?\d*)\b/i,
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
    /(?:todo\s+m[eê]s|mensalmente|recorrente)\s+(.+?)\s+(?:r\$\s*)?(\d+[.,]?\d*)\s+dia\s+(\d{1,2})\b/i,
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

  // Incompleta: "recorrente Netflix no valor de 28" / "todo mês Netflix no Nubank".
  // "mensal" no nome (tarifa mensal) não entra — exige todo mês / mensalmente / recorrente / assinatura.
  if (
    SINAL_CRIAR_RECORRENCIA.test(lower) ||
    /\bassinatura\b/.test(lower)
  ) {
    const m = lower.match(
      /(?:todo\s+m[eê]s|mensalmente|recorrente|assinatura(?:\s+recorrente)?)\s+(?:dia\s+(\d{1,2})\s+)?(.+)/i,
    );
    if (m?.[2]) {
      const diaBruto = m[1] ? Number(m[1]) : null;
      const dia =
        diaBruto != null && diaBruto >= 1 && diaBruto <= 31 ? diaBruto : null;
      const valor = extrair_valor_recorrencia(texto);
      const trecho = limpar_trecho_descricao(m[2]);
      const { descricao, conta_nome, cartao_nome } = separar_descricao_e_origem(
        trecho,
        texto,
        contexto,
      );
      if (descricao.length >= 2) {
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
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Prefere "no valor de 28"; evita confundir com dia. */
function extrair_valor_recorrencia(texto: string): number | null {
  const lower = texto.toLocaleLowerCase("pt-BR");
  const comRotulo =
    /\b(?:no\s+)?valor\s*(?:de\s+)?(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+[.,]?\d*)\b/i.exec(
      lower,
    );
  if (comRotulo?.[1]) {
    const bruto = comRotulo[1];
    const n = bruto.includes(",")
      ? Number(bruto.replace(/\./g, "").replace(",", "."))
      : Number(bruto.replace(",", "."));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return extrair_valor_ignorando_dia(lower);
}

function extrair_valor_ignorando_dia(texto: string): number | null {
  const limpo = texto
    .replace(/\bdia\s+\d{1,2}\b/gi, " ")
    .replace(/\b(?:hoje|hj)\b/gi, " ");
  return extrair_valor(limpo);
}

function limpar_trecho_descricao(trecho: string): string {
  return trecho
    .replace(/\bdia\s+\d{1,2}\b/gi, " ")
    .replace(/\b(?:no\s+)?valor\s*(?:de\s+)?(?:r\$\s*)?\d+[.,]?\d*\b/gi, " ")
    .replace(/(?:r\$\s*)?\d+[.,]?\d*/g, " ")
    .replace(/\b(?:lancamento|lançamento|de|da|do|assinatura|recorrente)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Netflix no Nubank" → descrição + conta/cartão textual. */
function separar_descricao_e_origem(
  trechoLower: string,
  textoOriginal: string,
  contexto?: ContextoInterpretacao | null,
): { descricao: string; conta_nome: string | null; cartao_nome: string | null } {
  const origem = extrair_origem_no_na(textoOriginal, contexto);
  let descricao = trechoLower
    .replace(/\b(?:no|na|em)\s+(?:cart[aã]o\s+|conta\s+)?[a-záàâãéêíóôõúç0-9][\wáàâãéêíóôõúç0-9\s.-]{1,40}$/i, "")
    .replace(/\b(?:no\s+)?valor\s*(?:de\s+)?(?:r\$\s*)?\d+[.,]?\d*\b/gi, " ")
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

function eh_lixo_origem(nome: string): boolean {
  const lower = nome.trim().toLocaleLowerCase("pt-BR");
  if (!lower) return true;
  if (/^valor(\s|$|de\b)/i.test(lower)) return true;
  if (/^r\$/.test(lower)) return true;
  if (/^\d+[.,]?\d*$/.test(lower)) return true;
  if (/^(de|da|do|dos|das)$/i.test(lower)) return true;
  return false;
}

function nome_casa(cadastro: string, buscado: string): boolean {
  const a = cadastro.toLocaleLowerCase("pt-BR");
  const b = buscado.toLocaleLowerCase("pt-BR");
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * Origem só com match no cadastro ou "cartão/conta X" explícito (não lixo).
 * Nunca inventa cartão a partir de "no valor de 28".
 */
function extrair_origem_no_na(
  texto: string,
  contexto?: ContextoInterpretacao | null,
): {
  conta_nome: string | null;
  cartao_nome: string | null;
} {
  const semValor = texto
    .replace(/\b(?:no\s+)?valor\s*(?:de\s+)?(?:r\$\s*)?\d+[.,]?\d*\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const m = semValor.match(
    /\b(?:no|na|em)\s+(?:(cart[aã]o|conta)\s+)?([A-Za-zÁ-ú0-9][\wÁ-ú0-9 .-]{1,40})\s*$/i,
  );
  if (!m?.[2]) return { conta_nome: null, cartao_nome: null };

  const nome = m[2].trim().replace(/\s+/g, " ");
  if (eh_lixo_origem(nome)) return { conta_nome: null, cartao_nome: null };

  const nomeLower = nome.toLocaleLowerCase("pt-BR");
  const tipoExplicito = m[1]?.toLocaleLowerCase("pt-BR") ?? "";
  const pediuCartao = tipoExplicito.startsWith("cart") || /\bcart[aã]o\b/i.test(texto);
  const pediuConta = tipoExplicito === "conta" || /\bconta\b/i.test(texto);

  const cartao = contexto?.cartoes.find((c) => nome_casa(c.nome, nomeLower));
  const conta = contexto?.contas.find((c) => nome_casa(c.nome, nomeLower));

  if (pediuCartao) {
    if (cartao) return { conta_nome: null, cartao_nome: cartao.nome };
    // Explícito "cartão X" — guarda o nome; o normalizador valida no cadastro.
    return { conta_nome: null, cartao_nome: capitalizar(nome) };
  }
  if (pediuConta) {
    if (conta) return { conta_nome: conta.nome, cartao_nome: null };
    return { conta_nome: capitalizar(nome), cartao_nome: null };
  }

  if (cartao) return { conta_nome: null, cartao_nome: cartao.nome };
  if (conta) return { conta_nome: conta.nome, cartao_nome: null };

  // Sem palavra cartão/conta e sem match: não inventa origem.
  return { conta_nome: null, cartao_nome: null };
}

function capitalizar(texto: string): string {
  if (!texto) return texto;
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
