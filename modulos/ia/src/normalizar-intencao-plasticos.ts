import type { IntencaoDetectada } from "@lancai/tipos";
import { extrair_dados_plasticos_da_mensagem } from "./cifragem-cartao";

function como_texto_plastico(valor: unknown): string | null {
  if (typeof valor === "number" && Number.isFinite(valor)) {
    return String(Math.trunc(valor));
  }
  if (typeof valor === "string") {
    const texto = valor.trim();
    return texto.length > 0 ? texto : null;
  }
  return null;
}

/**
 * Completa número/validade/CVV a partir da mensagem do usuário quando a IA
 * devolve CORRIGIR_CARTAO ou CRIAR_CARTAO com plástico incompleto.
 */
export function normalizar_intencao_plasticos(
  intencao: IntencaoDetectada,
  mensagem: string,
): IntencaoDetectada {
  const extraidos = extrair_dados_plasticos_da_mensagem(mensagem);
  if (!extraidos.numero && !extraidos.validade && !extraidos.cvv) {
    return intencao;
  }

  if (intencao.intencao === "CORRIGIR_CARTAO") {
    const alterados = { ...intencao.campos_alterados };
    const jaTemPlastico =
      alterados.numero != null || alterados.validade != null || alterados.cvv != null;
    const mensagemParecePlastico =
      /\b(dados|n[uú]mero|validade|cvv|pl[aá]stico)\b/i.test(mensagem) || Boolean(extraidos.numero);

    if (!jaTemPlastico && !mensagemParecePlastico) return intencao;

    return {
      ...intencao,
      campos_alterados: {
        ...alterados,
        numero: como_texto_plastico(alterados.numero) ?? extraidos.numero ?? null,
        validade: como_texto_plastico(alterados.validade) ?? extraidos.validade ?? null,
        cvv: como_texto_plastico(alterados.cvv) ?? extraidos.cvv ?? null,
      },
    };
  }

  if (intencao.intencao === "CRIAR_CARTAO") {
    return {
      ...intencao,
      numero: como_texto_plastico(intencao.numero) ?? extraidos.numero ?? null,
      validade: como_texto_plastico(intencao.validade) ?? extraidos.validade ?? null,
      cvv: como_texto_plastico(intencao.cvv) ?? extraidos.cvv ?? null,
    };
  }

  return intencao;
}
