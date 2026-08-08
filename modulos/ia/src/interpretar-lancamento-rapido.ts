import type { IntencaoDetectada, IntencaoRegistrarMovimento, TipoMovimento } from "@lancai/tipos";
import { inferir_origem_da_mensagem, normalizar_texto_busca } from "./inferir-origem-movimento";
import { enxugar_descricao_lancamento } from "./normalizar-descricao";
import {
  inferir_perfil_da_mensagem,
  normalizar_intencao_movimento,
} from "./normalizar-intencao-movimento";
import type { ContextoInterpretacao } from "./prompt";
import { mensagem_parece_resposta_slot } from "./ramos-intencao";

const VERBOS_DESPESA = /\b(gastei|paguei|comprei|debitei)\b/i;
const VERBOS_RECEITA = /\b(recebi|ganhei)\b/i;
const FORA_DO_ATALHO =
  /\b(corrige|corrigir|altera|muda|exclui|apaga|remove|cadastr|mostra|quanto|qual|menu|ajuda|transfer|pix\s+pra|saldo|limite|dados\s+do\s+cart)/i;

function extrair_valor_monetario(mensagem: string, aceitarNumeroSolto = false): number | null {
  const texto = mensagem.replace(/\bdia\s+\d{1,2}\b/gi, " ");
  const comCentavos =
    /R\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/.exec(texto) ??
    /\b(\d{1,3}(?:\.\d{3})*,\d{2})\b/.exec(texto) ??
    /\b(\d+,\d{2})\b/.exec(texto);

  if (comCentavos?.[1]) {
    const numero = Number(comCentavos[1].replace(/\./g, "").replace(",", "."));
    return Number.isFinite(numero) && numero > 0 ? numero : null;
  }

  const comReais =
    /\b(\d{1,3}(?:\.\d{3})*|\d{1,6})\s*reais?\b/i.exec(texto);
  if (comReais?.[1]) {
    const numero = Number(comReais[1].replace(/\./g, ""));
    return Number.isFinite(numero) && numero > 0 ? numero : null;
  }

  const inteiroAposVerbo =
    /\b(?:gastei|paguei|comprei|recebi|ganhei|debitei)\s+(?:r\$\s*)?(\d{1,6})(?:\s|$|,)/i.exec(
      texto,
    );
  if (inteiroAposVerbo?.[1]) {
    const numero = Number(inteiroAposVerbo[1]);
    return Number.isFinite(numero) && numero > 0 ? numero : null;
  }

  if (aceitarNumeroSolto) {
    const soNumero = /^\s*(?:r\$\s*)?(\d{1,6}(?:[.,]\d{1,2})?)\s*$/i.exec(texto);
    if (soNumero?.[1]) {
      const bruto = soNumero[1];
      const numero = bruto.includes(",")
        ? Number(bruto.replace(/\./g, "").replace(",", "."))
        : Number(bruto.replace(",", "."));
      return Number.isFinite(numero) && numero > 0 ? numero : null;
    }
  }

  return null;
}

/**
 * Resposta curta ao slot ("50", "no Nubank", "pessoal") — reconstrói o
 * REGISTRAR a partir dos dados_parciais sem chamar a LLM.
 */
function interpretar_resposta_slot(
  texto: string,
  contexto: ContextoInterpretacao,
): IntencaoDetectada | null {
  const pendente = contexto.intencaoPendente;
  if (pendente?.intencao_pendente !== "REGISTRAR_MOVIMENTO") return null;
  if (FORA_DO_ATALHO.test(texto)) return null;

  const parciais = pendente.dados_parciais ?? {};
  const descricao =
    typeof parciais.descricao === "string" && parciais.descricao.trim()
      ? String(parciais.descricao).trim()
      : "";
  if (!descricao) return null;

  const valorMsg = extrair_valor_monetario(texto, true);
  const origem = inferir_origem_da_mensagem(texto, contexto);
  const perfil = inferir_perfil_da_mensagem(texto);
  const temSinal =
    valorMsg != null ||
    Boolean(origem.conta_nome || origem.cartao_nome) ||
    perfil != null ||
    mensagem_parece_resposta_slot(texto);

  if (!temSinal) return null;

  const esqueleto: IntencaoRegistrarMovimento = {
    intencao: "REGISTRAR_MOVIMENTO",
    tipo_movimento: parciais.tipo_movimento === "receita" ? "receita" : "despesa",
    descricao,
    valor: valorMsg ?? (typeof parciais.valor === "number" ? parciais.valor : null),
    data_movimento:
      typeof parciais.data_movimento === "string" ? parciais.data_movimento : null,
    perfil:
      perfil ?? (parciais.perfil === "pf" || parciais.perfil === "pj" ? parciais.perfil : null),
    conta_nome:
      origem.conta_nome ??
      (typeof parciais.conta_nome === "string" ? parciais.conta_nome : null),
    cartao_nome:
      origem.cartao_nome ??
      (typeof parciais.cartao_nome === "string" ? parciais.cartao_nome : null),
    categoria_nome:
      typeof parciais.categoria_nome === "string" ? parciais.categoria_nome : null,
    forma_pagamento:
      typeof parciais.forma_pagamento === "string"
        ? (parciais.forma_pagamento as IntencaoRegistrarMovimento["forma_pagamento"])
        : null,
  };

  // Devolve mesmo se ainda faltar campo — o normalizador pergunta o próximo.
  return normalizar_intencao_movimento(esqueleto, contexto, texto);
}

function inferir_tipo_movimento(mensagem: string): TipoMovimento | null {
  if (VERBOS_RECEITA.test(mensagem)) return "receita";
  if (VERBOS_DESPESA.test(mensagem)) return "despesa";
  return null;
}

function extrair_descricao(
  mensagem: string,
  contexto: ContextoInterpretacao,
  origem: { conta_nome?: string; cartao_nome?: string },
): string | null {
  let texto = mensagem;

  if (origem.cartao_nome) {
    texto = texto.replace(new RegExp(origem.cartao_nome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
  }
  if (origem.conta_nome) {
    texto = texto.replace(new RegExp(origem.conta_nome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
  }

  for (const cartao of contexto.cartoes) {
    for (const token of normalizar_texto_busca(cartao.nome).split(/[^a-z0-9]+/).filter((t) => t.length >= 3)) {
      texto = texto.replace(new RegExp(`\\b${token}\\b`, "gi"), " ");
    }
  }
  for (const conta of contexto.contas) {
    for (const token of normalizar_texto_busca(conta.nome).split(/[^a-z0-9]+/).filter((t) => t.length >= 3)) {
      texto = texto.replace(new RegExp(`\\b${token}\\b`, "gi"), " ");
    }
  }

  texto = texto
    .replace(/\b(hoje|ontem|anteontem)\b/gi, " ")
    .replace(/\bno dia\b/gi, " ")
    .replace(/\bdia\s+\d{1,2}\b/gi, " ")
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ")
    .replace(/R\$?\s*[\d.]+(?:,\d{2})?/gi, " ")
    .replace(/\b\d{1,3}(?:\.\d{3})*,\d{2}\b/g, " ")
    .replace(/\b\d+,\d{2}\b/g, " ")
    .replace(/\b\d{1,6}\s*reais?\b/gi, " ")
    .replace(/\breais?\b/gi, " ")
    .replace(/\b(gastei|paguei|comprei|recebi|ganhei|debitei)\b/gi, " ")
    .replace(/\b(cart[aã]o|conta|banco)\b/gi, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (texto.length < 2) return null;
  const enxuta = enxugar_descricao_lancamento(texto);
  if (!enxuta || enxuta.length < 2 || enxuta.toLocaleLowerCase("pt-BR") === "lançamento") {
    return null;
  }
  return enxuta;
}

/**
 * Atalho determinístico para lançamentos óbvios ("gastei X na Y no cartão Z")
 * e respostas curtas de slot-filling. Retorna null para cair no InterpretadorIntencoes.
 */
export function interpretar_lancamento_rapido(
  mensagem: string,
  contexto: ContextoInterpretacao,
): IntencaoDetectada | null {
  const texto = mensagem.trim();
  if (!texto) return null;

  const slot = interpretar_resposta_slot(texto, contexto);
  if (slot) return slot;

  if (FORA_DO_ATALHO.test(texto)) return null;

  const tipo = inferir_tipo_movimento(texto);
  if (!tipo) return null;

  const valor = extrair_valor_monetario(texto);
  if (valor == null) return null;

  const origem = inferir_origem_da_mensagem(texto, contexto);

  const descricao = extrair_descricao(texto, contexto, origem);
  if (!descricao) return null;

  const esqueleto: IntencaoRegistrarMovimento = {
    intencao: "REGISTRAR_MOVIMENTO",
    tipo_movimento: tipo,
    valor,
    descricao,
    cartao_nome: origem.cartao_nome ?? null,
    conta_nome: origem.conta_nome ?? null,
  };

  const normalizada = normalizar_intencao_movimento(esqueleto, contexto, texto);
  if (normalizada.intencao !== "REGISTRAR_MOVIMENTO") return null;
  if (!normalizada.conta_nome && !normalizada.cartao_nome) return null;

  return normalizada;
}
