import type { MensagemHistorico } from "@lancai/ia";
import type { IntencaoCriarRegraAprendizado, IntencaoDetectada } from "@lancai/tipos";

const PADRAO_VIRAR_REGRA = /Quer transformar em regra\?/;
const AFIRMATIVAS = /^(sim|confirmo|confirma|pode criar|ok|quero|yes)\.?$/i;
const NEGATIVAS = /^(não|nao|cancela|cancelar|não quero|nao quero|pular|no)\.?$/i;

/** Extrai se a última mensagem do sistema ofereceu “virar regra?”. */
export function extrair_pendencia_virar_regra(historicoRecente: MensagemHistorico[]): boolean {
  for (let i = historicoRecente.length - 1; i >= 0; i -= 1) {
    const mensagem = historicoRecente[i];
    if (mensagem?.papel !== "sistema") continue;
    return PADRAO_VIRAR_REGRA.test(mensagem.conteudo);
  }
  return false;
}

/**
 * Atalho: se o sistema ofereceu virar regra e o usuário responde "sim"/"não",
 * monta CRIAR_REGRA_APRENDIZADO com a referência do CORRIGIR_MOVIMENTO anterior.
 */
export function interpretar_resposta_confirmacao_regra(
  mensagem: string,
  historicoRecente: MensagemHistorico[],
  ultimaIntencaoIa: IntencaoDetectada | null,
): IntencaoCriarRegraAprendizado | null {
  if (!extrair_pendencia_virar_regra(historicoRecente)) return null;
  if (!ultimaIntencaoIa || ultimaIntencaoIa.intencao !== "CORRIGIR_MOVIMENTO") return null;
  if (!ultimaIntencaoIa.campos_alterados.categoria_nome) return null;

  const texto = mensagem.trim();

  if (AFIRMATIVAS.test(texto)) {
    return {
      intencao: "CRIAR_REGRA_APRENDIZADO",
      confirmado: true,
      referencia: ultimaIntencaoIa.referencia,
    };
  }

  if (NEGATIVAS.test(texto)) {
    return {
      intencao: "CRIAR_REGRA_APRENDIZADO",
      confirmado: false,
    };
  }

  return null;
}
