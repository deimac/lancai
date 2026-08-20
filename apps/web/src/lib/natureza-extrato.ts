import type { MovimentoResumo } from "./api";

export type NaturezaExtrato = "fatura" | "parcela" | "recorrente" | "avista";

export function natureza_do_movimento(
  movimento: Pick<
    MovimentoResumo,
    "papel" | "parcelaNumero" | "parcelaTotal" | "fonte"
  >,
): NaturezaExtrato {
  if (movimento.papel === "pagamento_fatura") return "fatura";
  if (
    movimento.parcelaNumero != null &&
    movimento.parcelaTotal != null &&
    movimento.parcelaTotal >= 2
  ) {
    return "parcela";
  }
  if (movimento.fonte === "recorrencia") return "recorrente";
  return "avista";
}

export function rotulo_natureza(
  movimento: Pick<
    MovimentoResumo,
    "papel" | "parcelaNumero" | "parcelaTotal" | "fonte"
  >,
): string {
  const natureza = natureza_do_movimento(movimento);
  if (natureza === "fatura") return "Fatura";
  if (natureza === "parcela") {
    return `Parcela ${movimento.parcelaNumero}/${movimento.parcelaTotal}`;
  }
  if (natureza === "recorrente") return "Recorrente";
  return "À vista";
}

export type StatusVisualExtrato = "concluida" | "agendada" | "vencida" | "cancelada";

export function status_visual_movimento(
  movimento: Pick<MovimentoResumo, "status" | "dataMovimento">,
  hojeISO: string,
): StatusVisualExtrato {
  if (movimento.status === "cancelado") return "cancelada";
  if (movimento.status === "realizado") return "concluida";
  if (movimento.dataMovimento < hojeISO) return "vencida";
  return "agendada";
}

export function rotulo_status_visual(status: StatusVisualExtrato): string {
  if (status === "concluida") return "Concluída";
  if (status === "agendada") return "Agendada";
  if (status === "vencida") return "Vencida";
  return "Cancelada";
}

export function pode_excluir_movimento(fonte: string): boolean {
  return fonte !== "open_finance";
}
