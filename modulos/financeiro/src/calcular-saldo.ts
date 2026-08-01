import { arredondar } from "@lancai/tipos";
import type { TipoMovimento } from "@lancai/tipos";
import { ErroTipoMovimentoNaoImplementado } from "./erros";

export type DirecaoConta = "origem" | "destino" | "unica";

/**
 * Direção padrão do impacto no saldo de uma `conta` por tipo de movimento,
 * para lançamentos que afetam uma única conta (não é usado para 'transferencia',
 * que tem regra própria por ter duas pontas).
 *
 * Fase 2 implementa apenas receita/despesa. Reembolso, empréstimo, estorno,
 * retirada e aporte são adicionados na Fase 3 (ver modulos/financeiro/src/motor-financeiro.ts).
 */
const DIRECAO_PADRAO_POR_TIPO: Partial<Record<TipoMovimento, 1 | -1>> = {
  receita: 1,
  despesa: -1,
};

/**
 * Calcula o novo `saldo_atual` de uma conta a partir do saldo atual e de um
 * lançamento realizado. Função pura — não lê nem escreve no banco.
 */
export function calcular_saldo(
  saldoAtual: number,
  tipo: TipoMovimento,
  valor: number,
  direcaoConta: DirecaoConta = "unica",
): number {
  if (tipo === "transferencia") {
    const sinal = direcaoConta === "destino" ? 1 : -1;
    return arredondar(saldoAtual + sinal * valor);
  }

  const sinal = DIRECAO_PADRAO_POR_TIPO[tipo];
  if (sinal === undefined) {
    throw new ErroTipoMovimentoNaoImplementado(tipo);
  }
  return arredondar(saldoAtual + sinal * valor);
}

/** Tipos de movimento cujo efeito em `calcular_saldo` já está implementado. */
export function tipo_movimento_implementado(tipo: TipoMovimento): boolean {
  return tipo === "transferencia" || tipo in DIRECAO_PADRAO_POR_TIPO;
}
