import type { MovimentoResumo } from "./api";

export function eh_nao_classificado(nome: string | null | undefined): boolean {
  if (!nome?.trim()) return true;
  return nome.toLocaleLowerCase("pt-BR") === "não classificado";
}

export function eh_categoria_pagamento_fatura(nome: string): boolean {
  return nome.toLocaleLowerCase("pt-BR") === "pagamento de fatura";
}

/** Só entra na fila quem ainda está sem categoria — IA baixa não conta se já tem classificação. */
export function precisa_revisao(movimento: MovimentoResumo): boolean {
  if (movimento.apresentacao) return false;
  if (movimento.status === "cancelado") return false;
  if (movimento.papel === "pagamento_fatura") return false;
  return eh_nao_classificado(movimento.categoriaNome);
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
