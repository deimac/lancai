import type { IntencaoDetectada, IntencaoRegistrarMovimento, TipoMovimento } from "@lancai/tipos";
import { inferir_origem_da_mensagem, normalizar_texto_busca } from "./inferir-origem-movimento";
import { normalizar_intencao_movimento } from "./normalizar-intencao-movimento";
import type { ContextoInterpretacao } from "./prompt";

const VERBOS_DESPESA = /\b(gastei|paguei|comprei|debitei)\b/i;
const VERBOS_RECEITA = /\b(recebi|ganhei)\b/i;
const FORA_DO_ATALHO =
  /\b(corrige|corrigir|altera|muda|exclui|apaga|remove|cadastr|mostra|quanto|qual|menu|ajuda|transfer|pix\s+pra|saldo|limite|dados\s+do\s+cart)/i;

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function extrair_valor_monetario(mensagem: string): number | null {
  const comCentavos =
    /R\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/.exec(mensagem) ??
    /\b(\d{1,3}(?:\.\d{3})*,\d{2})\b/.exec(mensagem) ??
    /\b(\d+,\d{2})\b/.exec(mensagem);

  if (comCentavos?.[1]) {
    const numero = Number(comCentavos[1].replace(/\./g, "").replace(",", "."));
    return Number.isFinite(numero) && numero > 0 ? numero : null;
  }

  const inteiroAposVerbo =
    /\b(?:gastei|paguei|comprei|recebi|ganhei|debitei)\s+(?:r\$\s*)?(\d{1,6})(?:\s|$|,)/i.exec(
      mensagem,
    );
  if (inteiroAposVerbo?.[1]) {
    const numero = Number(inteiroAposVerbo[1]);
    return Number.isFinite(numero) && numero > 0 ? numero : null;
  }

  return null;
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
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ")
    .replace(/R\$?\s*[\d.]+(?:,\d{2})?/gi, " ")
    .replace(/\b\d{1,3}(?:\.\d{3})*,\d{2}\b/g, " ")
    .replace(/\b\d+,\d{2}\b/g, " ")
    .replace(/\b(gastei|paguei|comprei|recebi|ganhei|debitei)\b/gi, " ")
    .replace(/\b(cart[aã]o|conta|banco)\b/gi, " ")
    .replace(/\b(no|na|nos|nas|com|do|da|de|em|o|a|um|uma|meu|minha|pra|para|pelo|pela)\b/gi, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (texto.length < 2) return null;
  return capitalizar(texto);
}

/**
 * Atalho determinístico para lançamentos óbvios ("gastei X na Y no cartão Z").
 * Evita a latência da IA quando valor + verbo + conta/cartão já estão claros.
 * Retorna null para cair no InterpretadorIntencoes.
 */
export function interpretar_lancamento_rapido(
  mensagem: string,
  contexto: ContextoInterpretacao,
): IntencaoDetectada | null {
  const texto = mensagem.trim();
  if (!texto || FORA_DO_ATALHO.test(texto)) return null;

  // Ambíguo demais para atalho — a IA interpreta descrição/data/categoria.
  if (/\bdia\s+\d{1,2}\b/i.test(texto) && !/\d{1,2}\/\d{1,2}/.test(texto)) return null;
  if (/\breais?\b/i.test(texto)) return null;

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
