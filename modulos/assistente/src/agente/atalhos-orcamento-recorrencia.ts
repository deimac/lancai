import type { IntencaoDetectada } from "@lancai/tipos";
import type { ContextoInterpretacao } from "@lancai/ia";

const ACAO_ESCRITA_FORTE =
  /\b(corrige|corrigir|apague|apaga|cancela lançamento|exclui lançamento)\b/i;
const CORRECAO_LANCAMENTO =
  /\b(corrige|corrigir|altera|alterar|muda|mudar|atualiza|atualizar)\b/i;
const SINAL_CRIAR_RECORRENCIA = /\b(?:todo\s+m[eê]s|mensalmente|recorrente)\b/i;

function extrairValor(texto: string): number | null {
  const m = texto.match(/(?:r\$\s*)?(\d+[.,]?\d*)/);
  if (!m?.[1]) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function capitalizar(texto: string): string {
  const t = texto.trim();
  if (!t) return t;
  return t.charAt(0).toLocaleUpperCase("pt-BR") + t.slice(1);
}

function origemNoNa(texto: string): { conta_nome: string | null; cartao_nome: string | null } {
  const cartao = /\bno\s+cart[aã]o\s+(.+)$/i.exec(texto);
  if (cartao?.[1]) return { conta_nome: null, cartao_nome: cartao[1].trim() };
  const no = /\bno\s+([a-záàâãéêíóôõúç0-9][a-záàâãéêíóôõúç0-9\s]{1,30})$/i.exec(texto.trim());
  if (no?.[1]) return { conta_nome: no[1].trim(), cartao_nome: null };
  return { conta_nome: null, cartao_nome: null };
}

/**
 * Atalho de orçamento (espelha o legado em apps/api, sem depender da API).
 */
export function interpretarOrcamentoRapido(mensagem: string): IntencaoDetectada | null {
  const texto = mensagem.trim();
  if (!texto || ACAO_ESCRITA_FORTE.test(texto)) return null;
  const lower = texto.toLocaleLowerCase("pt-BR");

  if (
    /\b(como\s+est[aá]|status|mostra|mostre|ver|veja|consultar?)\b/.test(lower) &&
    /\bor[cç]amento\b/.test(lower)
  ) {
    return { intencao: "CONSULTAR_ORCAMENTO", categoria_nome: null };
  }

  const definir = lower.match(
    /\bor[cç]amento(?:\s+de|\s+para)?\s+([a-záàâãéêíóôõúç\s]{2,40}?)?\s*(?:de\s+)?(?:r\$\s*)?(\d+[.,]?\d*)/i,
  );
  if (definir?.[2]) {
    const valor = Number(definir[2].replace(",", "."));
    if (!Number.isFinite(valor) || valor <= 0) return null;
    const catBruta = definir[1]?.trim();
    const categoria_nome =
      catBruta && !/^(de|para|mensal|geral)$/i.test(catBruta) ? catBruta : null;
    return { intencao: "DEFINIR_ORCAMENTO", valor_limite: valor, categoria_nome };
  }
  return null;
}

/**
 * Atalho de recorrência (casos completos cobertos pelos testes da Fase 1).
 */
export function interpretarRecorrenciaRapida(
  mensagem: string,
  _contexto?: ContextoInterpretacao | null,
): IntencaoDetectada | null {
  const texto = mensagem.trim();
  if (!texto) return null;
  const lower = texto.toLocaleLowerCase("pt-BR");
  if (CORRECAO_LANCAMENTO.test(texto) && !/\brecorr[eê]n\b/i.test(lower)) return null;

  const comDiaAntes = lower.match(
    /(?:todo\s+m[eê]s|mensalmente|recorrente)\s+dia\s+(\d{1,2})\s+(.+?)\s+(?:r\$\s*)?(\d+[.,]?\d*)\b/i,
  );
  if (comDiaAntes) {
    const dia = Number(comDiaAntes[1]);
    const valor = Number(comDiaAntes[3]!.replace(",", "."));
    const origem = origemNoNa(texto);
    let desc = comDiaAntes[2]!.replace(/\bno\s+.+$/i, "").trim();
    desc = desc.replace(/\bdia\s+\d{1,2}\b/i, "").trim();
    if (desc.length >= 2 && valor > 0 && dia >= 1 && dia <= 31) {
      return {
        intencao: "CRIAR_RECORRENCIA",
        descricao: capitalizar(desc),
        valor,
        dia_do_mes: dia,
        tipo_movimento: "despesa",
        conta_nome: origem.conta_nome,
        cartao_nome: origem.cartao_nome,
      };
    }
  }

  if (SINAL_CRIAR_RECORRENCIA.test(lower) || /\bassinatura\b/.test(lower)) {
    const valor = extrairValor(lower.replace(/\bdia\s+\d{1,2}\b/gi, " "));
    const diaM = /\bdia\s+(\d{1,2})\b/i.exec(lower);
    const dia = diaM ? Number(diaM[1]) : null;
    return {
      intencao: "CRIAR_RECORRENCIA",
      descricao: "Recorrência",
      valor,
      dia_do_mes: dia && dia >= 1 && dia <= 31 ? dia : null,
      tipo_movimento: "despesa",
    };
  }
  return null;
}
