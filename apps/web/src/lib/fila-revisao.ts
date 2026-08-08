import { LIMIAR_BAIXA_CONFIANCA } from "@lancai/tipos";
import type { MovimentoResumo } from "./api";

export { LIMIAR_BAIXA_CONFIANCA };

export function eh_nao_classificado(nome: string): boolean {
  return nome.toLocaleLowerCase("pt-BR") === "não classificado";
}

/** Não classificado ou IA com confiança baixa — fila de trabalho do extrato. */
export function precisa_revisao(movimento: MovimentoResumo): boolean {
  if (movimento.status === "cancelado") return false;
  if (eh_nao_classificado(movimento.categoriaNome)) return true;
  if (
    movimento.classificadoPor === "ia" &&
    movimento.confiancaIa !== null &&
    movimento.confiancaIa < LIMIAR_BAIXA_CONFIANCA
  ) {
    return true;
  }
  return false;
}

export function rotulo_classificado_por(
  origem: MovimentoResumo["classificadoPor"],
  confianca: number | null,
): string {
  if (origem === "regra") return "Regra";
  if (origem === "usuario") return "Você";
  if (confianca === null) return "IA";
  return `IA ${Math.round(confianca * 100)}%`;
}

/** Frase completa para tooltip / linha auxiliar — 09-REGRAS §9.4. */
export function explicacao_classificacao(movimento: Pick<
  MovimentoResumo,
  "classificadoPor" | "confiancaIa" | "regraTrecho" | "classificadoEm"
>): string {
  const quando = formatar_data_curta(movimento.classificadoEm);

  if (movimento.classificadoPor === "regra") {
    const trecho = movimento.regraTrecho?.trim();
    if (trecho) {
      return quando
        ? `Classificado pela regra «${trecho}» em ${quando}`
        : `Classificado pela regra «${trecho}»`;
    }
    return quando ? `Classificado por uma regra em ${quando}` : "Classificado por uma regra";
  }

  if (movimento.classificadoPor === "ia") {
    const pct =
      movimento.confiancaIa === null ? null : `${Math.round(movimento.confiancaIa * 100)}%`;
    if (pct && quando) return `Sugestão da IA com ${pct} de confiança em ${quando}`;
    if (pct) return `Sugestão da IA com ${pct} de confiança`;
    return quando ? `Sugestão da IA em ${quando}` : "Sugestão da IA";
  }

  return quando ? `Você classificou em ${quando}` : "Você classificou";
}

function formatar_data_curta(iso: string | null): string | null {
  if (!iso) return null;
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return null;
  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}
