import type { MensagemHistorico } from "@lancai/ia";
import type { IntencaoDetectada, IntencaoRegistrarMovimento } from "@lancai/tipos";

const PADRAO_DUPLICATA = /Já existe um lançamento igual:/;
const AFIRMATIVAS = /^(sim|confirmo|confirma|pode registrar|pode lançar|ok|quero|yes)\.?$/i;
const NEGATIVAS = /^(não|nao|cancela|cancelar|não quero|nao quero|no)\.?$/i;

/** Extrai se a última mensagem do sistema pediu confirmação de duplicata. */
export function extrair_pendencia_duplicata(historicoRecente: MensagemHistorico[]): boolean {
  for (let i = historicoRecente.length - 1; i >= 0; i -= 1) {
    const mensagem = historicoRecente[i];
    if (mensagem?.papel !== "sistema") continue;
    return PADRAO_DUPLICATA.test(mensagem.conteudo);
  }
  return false;
}

/**
 * Atalho: se o sistema pediu confirmação de duplicata e o usuário responde
 * "sim"/"não", remonta REGISTRAR_MOVIMENTO com confirmado (ou cancela).
 */
export function interpretar_resposta_confirmacao_duplicata(
  mensagem: string,
  historicoRecente: MensagemHistorico[],
  ultimaIntencaoIa: IntencaoDetectada | null,
): IntencaoDetectada | null {
  if (!extrair_pendencia_duplicata(historicoRecente)) return null;
  if (!ultimaIntencaoIa || ultimaIntencaoIa.intencao !== "REGISTRAR_MOVIMENTO") return null;

  const texto = mensagem.trim();

  if (AFIRMATIVAS.test(texto)) {
    const confirmada: IntencaoRegistrarMovimento = {
      ...ultimaIntencaoIa,
      confirmado: true,
    };
    return confirmada;
  }

  if (NEGATIVAS.test(texto)) {
    return {
      intencao: "NAO_RECONHECIDA",
      motivo: "Lançamento não registrado — já existia um igual.",
    };
  }

  return null;
}
