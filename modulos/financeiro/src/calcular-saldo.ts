import { arredondar } from "@lancai/tipos";
import type { TipoMovimento } from "@lancai/tipos";
import { ErroTipoMovimentoNaoImplementado } from "./erros";

export type DirecaoConta = "origem" | "destino" | "unica";

/**
 * Direção padrão do impacto no saldo de uma `conta` por tipo de movimento,
 * para lançamentos que afetam uma única conta (não é usado para 'transferencia',
 * que tem regra própria por ter duas pontas).
 *
 * Convenções assumidas pelo MotorFinanceiro (ajustáveis conforme feedback de uso real):
 * - `reembolso` e `estorno`: dinheiro voltando para a conta (mesma direção de receita).
 * - `aporte`: capital entrando na conta (ex.: sócio aportando na empresa).
 * - `retirada`: dinheiro saindo da conta (ex.: pró-labore saindo da conta da empresa).
 * - `emprestimo`: assume-se o caso mais comum em linguagem natural ("emprestei
 *   R$200 pro Marcio") — dinheiro saindo da conta de quem empresta.
 */
const DIRECAO_PADRAO_POR_TIPO: Partial<Record<TipoMovimento, 1 | -1>> = {
  receita: 1,
  despesa: -1,
  reembolso: 1,
  estorno: 1,
  aporte: 1,
  retirada: -1,
  emprestimo: -1,
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

/** Direção (+1/-1) usada por `criar_movimento`/`corrigir_movimento` para tipos de conta única. */
export function obter_direcao_padrao(tipo: TipoMovimento): 1 | -1 | undefined {
  return DIRECAO_PADRAO_POR_TIPO[tipo];
}
