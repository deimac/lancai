import type { Perfil } from "@lancai/tipos";

/**
 * Um movimento é "fluxo cruzado" quando o perfil do próprio lançamento
 * (o gasto/ganho em si) é diferente do perfil da conta/cartão usado para
 * pagá-lo — ex.: gasto pessoal pago com conta da empresa, ou gasto da
 * empresa pago com cartão pessoal.
 *
 * É puramente classificatório (usado pelo `modulos/relatorios` na Fase 5
 * para responder perguntas como "quanto gastei de pessoal com dinheiro da
 * empresa"): não gera nenhum lançamento de mútuo/dívida adicional, por
 * decisão explícita do produto (ver docs/documento-mestre.md, seção 4).
 */
export function eh_fluxo_cruzado(perfilMovimento: Perfil, perfilContaOuCartao: Perfil): boolean {
  return perfilMovimento !== perfilContaOuCartao;
}
