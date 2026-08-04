import type { MensagemHistorico } from "@lancai/ia";
import type { IntencaoDetectada } from "@lancai/tipos";

const PADRAO_CONTA_CARTAO =
  /Deseja realmente excluir (?:a|o) (conta|cartão) "([^"]+)"\?/;

const PADRAO_LANCAMENTO =
  /Deseja realmente excluir o lançamento "([^"]+)"(?: de (\d{2})\/(\d{2})\/(\d{4}))?(?:\s*\([^)]*\))?\?/;

const PADRAO_LANCAMENTOS =
  /Deseja realmente excluir os (\d+) lançamentos de "([^"]+)"(?: de (\d{2})\/(\d{2})\/(\d{4}))?(?:\s*\([^)]*\))?\?/;

const AFIRMATIVAS = /^(sim|confirmo|confirma|pode excluir|pode apagar|ok|quero|yes)\.?$/i;
const NEGATIVAS = /^(não|nao|cancela|cancelar|não quero|nao quero|no)\.?$/i;

export type PendenciaExclusao =
  | { tipo: "conta" | "cartão"; nome: string }
  | { tipo: "lançamento"; descricao: string; dataMovimento: string | null };

function data_br_para_iso(dia: string, mes: string, ano: string): string {
  return `${ano}-${mes}-${dia}`;
}

/** Extrai a pendência de exclusão da última mensagem do sistema no histórico. */
export function extrair_pendencia_exclusao(
  historicoRecente: MensagemHistorico[],
): PendenciaExclusao | null {
  for (let i = historicoRecente.length - 1; i >= 0; i -= 1) {
    const mensagem = historicoRecente[i];
    if (mensagem?.papel !== "sistema") continue;

    const varios = PADRAO_LANCAMENTOS.exec(mensagem.conteudo);
    if (varios) {
      return {
        tipo: "lançamento",
        descricao: varios[2]!,
        dataMovimento:
          varios[3] && varios[4] && varios[5]
            ? data_br_para_iso(varios[3], varios[4], varios[5])
            : null,
      };
    }

    const lancamento = PADRAO_LANCAMENTO.exec(mensagem.conteudo);
    if (lancamento) {
      return {
        tipo: "lançamento",
        descricao: lancamento[1]!,
        dataMovimento:
          lancamento[2] && lancamento[3] && lancamento[4]
            ? data_br_para_iso(lancamento[2], lancamento[3], lancamento[4])
            : null,
      };
    }

    const contaCartao = PADRAO_CONTA_CARTAO.exec(mensagem.conteudo);
    if (contaCartao) {
      return { tipo: contaCartao[1] as "conta" | "cartão", nome: contaCartao[2]! };
    }

    return null;
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
    if (pendencia.tipo === "lançamento") {
      return {
        intencao: "CORRIGIR_MOVIMENTO",
        referencia: {
          descricao: pendencia.descricao,
          data_movimento: pendencia.dataMovimento,
        },
        campos_alterados: { status: "cancelado", confirmado: true },
      };
    }
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
