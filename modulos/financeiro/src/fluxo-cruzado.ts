import type { Perfil } from "@lancai/tipos";

/**
 * Um movimento é "fluxo cruzado" quando o tipo de gasto do lançamento
 * (pessoal vs empresa) é diferente do perfil da conta/cartão usado para
 * pagá-lo — ex.: gasto pessoal pago com conta da empresa, ou gasto da
 * empresa pago com cartão pessoal.
 *
 * É puramente classificatório (usado pelo `modulos/relatorios` para responder
 * perguntas como "quanto gastei de pessoal com dinheiro da empresa"): não gera
 * nenhum lançamento de mútuo/dívida adicional, por decisão explícita do
 * produto (ver docs/09-REGRAS_DE_NEGOCIO.md, seção de fluxo cruzado).
 */
export function eh_fluxo_cruzado(perfilMovimento: Perfil, perfilContaOuCartao: Perfil): boolean {
  return perfilMovimento !== perfilContaOuCartao;
}
