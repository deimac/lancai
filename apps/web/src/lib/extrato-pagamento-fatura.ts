import {
  competencia_vencimento_da_quitacao,
  competencia_vencimento_proximo,
  linha_aceita_pagamento_fatura,
} from "@lancai/tipos";
import type { CartaoResumo, MovimentoResumo } from "./api";

const ROTULOS_MES = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

export function cartao_preferencial_fatura(
  movimento: Pick<MovimentoResumo, "contaId" | "cartaoId" | "cartaoFaturaId">,
  cartoes: CartaoResumo[],
): string | null {
  if (movimento.cartaoFaturaId) return movimento.cartaoFaturaId;
  if (movimento.cartaoId) return movimento.cartaoId;
  const preferidos = cartoes.filter((c) => c.contaId && c.contaId === movimento.contaId);
  return (preferidos[0] ?? cartoes[0])?.id ?? null;
}

export function competencia_default_fatura(
  movimento: Pick<MovimentoResumo, "dataMovimento" | "competenciaFatura">,
  cartao: Pick<CartaoResumo, "vencimento" | "fechamento"> | undefined,
): string {
  if (movimento.competenciaFatura) return movimento.competenciaFatura;
  const vencimento = cartao?.vencimento ?? 10;
  const fechamento = cartao?.fechamento;
  if (fechamento != null && fechamento >= 1) {
    return competencia_vencimento_da_quitacao(movimento.dataMovimento, fechamento, vencimento);
  }
  return competencia_vencimento_proximo(movimento.dataMovimento, vencimento);
}

export function opcoes_competencia(referenciaISO: string): Array<{ valor: string; rotulo: string }> {
  const [anoStr, mesStr] = referenciaISO.slice(0, 7).split("-");
  const ano = Number(anoStr);
  const mes = Number(mesStr);
  if (!ano || !mes) return [];
  const opcoes: Array<{ valor: string; rotulo: string }> = [];
  for (let i = 0; i < 14; i += 1) {
    const data = new Date(Date.UTC(ano, mes - 1 - i, 1));
    const y = data.getUTCFullYear();
    const m = data.getUTCMonth();
    const valor = `${y}-${String(m + 1).padStart(2, "0")}`;
    opcoes.push({ valor, rotulo: `${ROTULOS_MES[m]}/${String(y).slice(2)}` });
  }
  return opcoes;
}

export function mostra_check_pagamento_fatura(movimento: Pick<
  MovimentoResumo,
  "tipo" | "contaId" | "cartaoId" | "status"
>): boolean {
  if (movimento.status === "cancelado") return false;
  return linha_aceita_pagamento_fatura(movimento);
}

/**
 * Item do menu ⋯. Marcar só nos casos de quitação (saída na conta ou crédito
 * no cartão). Desmarcar sempre que a linha já estiver como pagamento de fatura,
 * mesmo que a classificação tenha sido um erro (entrada na conta, etc.).
 */
export function mostra_acao_pagamento_fatura(movimento: Pick<
  MovimentoResumo,
  "tipo" | "contaId" | "cartaoId" | "status" | "papel"
>): boolean {
  if (movimento.status === "cancelado") return false;
  if (movimento.papel === "pagamento_fatura") return true;
  return linha_aceita_pagamento_fatura(movimento);
}

export type ModoConvitePagamentoFatura = "nada" | "banner" | "check" | "marcado";

export function modo_convite_pagamento_fatura(entrada: {
  movimento: Pick<MovimentoResumo, "tipo" | "contaId" | "cartaoId" | "status" | "papel">;
  temSugestao: boolean;
  dispensou: boolean;
}): ModoConvitePagamentoFatura {
  if (!mostra_check_pagamento_fatura(entrada.movimento)) return "nada";
  if (entrada.movimento.papel === "pagamento_fatura") return "marcado";
  if (entrada.dispensou) return "nada";
  if (entrada.temSugestao) return "banner";
  return "check";
}

export function rotulo_check_pagamento_fatura(movimento: Pick<MovimentoResumo, "cartaoId">): string {
  return movimento.cartaoId
    ? "Crédito de pagamento da fatura?"
    : "É pagamento de fatura?";
}
