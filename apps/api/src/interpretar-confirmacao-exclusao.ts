import type { MensagemHistorico } from "@lancai/ia";
import type { IntencaoDetectada } from "@lancai/tipos";

const PADRAO_CONFIRMACAO =
  /Deseja realmente excluir (?:a|o) (conta|cartão) "([^"]+)"\?/;

const AFIRMATIVAS = /^(sim|confirmo|confirma|pode excluir|pode apagar|ok|quero|yes)\.?$/i;
const NEGATIVAS = /^(não|nao|cancela|cancelar|não quero|nao quero|no)\.?$/i;

export interface PendenciaExclusao {
  tipo: "conta" | "cartão";
  nome: string;
}

/** Extrai a pendência de exclusão da última mensagem do sistema no histórico. */
export function extrair_pendencia_exclusao(
  historicoRecente: MensagemHistorico[],
): PendenciaExclusao | null {
  for (let i = historicoRecente.length - 1; i >= 0; i -= 1) {
    const mensagem = historicoRecente[i];
    if (mensagem?.papel !== "sistema") continue;
    const match = PADRAO_CONFIRMACAO.exec(mensagem.conteudo);
    if (!match) return null;
    return { tipo: match[1] as "conta" | "cartão", nome: match[2]! };
  }
  return null;
}

/**
 * Atalho determinístico: se o sistema acabou de pedir confirmação de exclusão
 * e o usuário responde "sim"/"não", monta a intenção sem passar pela IA.
 */
export function interpretar_resposta_confirmacao_exclusao(
  mensagem: string,
  historicoRecente: MensagemHistorico[],
): IntencaoDetectada | null {
  const pendencia = extrair_pendencia_exclusao(historicoRecente);
  if (!pendencia) return null;

  const texto = mensagem.trim();

  if (AFIRMATIVAS.test(texto)) {
    if (pendencia.tipo === "conta") {
      return {
        intencao: "CORRIGIR_CONTA",
        conta_nome: pendencia.nome,
        campos_alterados: { ativo: false, confirmado: true },
      };
    }
    return {
      intencao: "CORRIGIR_CARTAO",
      cartao_nome: pendencia.nome,
      campos_alterados: { ativo: false, confirmado: true },
    };
  }

  if (NEGATIVAS.test(texto)) {
    return { intencao: "NAO_RECONHECIDA", motivo: "Exclusão cancelada." };
  }

  return null;
}
