import { formatarMoeda } from "@lancai/tipos";
import type { Cartao } from "@lancai/banco";
import type { DadosPlasticosCartao } from "@lancai/ia";

function rotuloPerfil(perfil: "pf" | "pj"): string {
  return perfil === "pj" ? "empresa" : "pessoal";
}

function formatar_numero_mascarado(numero: string): string {
  const grupos = numero.match(/.{1,4}/g);
  return grupos ? grupos.join(" ") : numero;
}

/** Resposta após senha válida — revela número/validade/CVV e dados da fatura. */
export function montar_dados_cartao_protegidos(cartao: Cartao, plasticos: DadosPlasticosCartao): string {
  return [
    `Dados do cartão "${cartao.nome}" (${rotuloPerfil(cartao.perfil)}):`,
    `- Número: ${formatar_numero_mascarado(plasticos.numero)}`,
    `- Validade: ${plasticos.validade}`,
    `- CVV: ${plasticos.cvv}`,
    `- Limite: ${formatarMoeda(cartao.limite)}`,
    `- Fecha dia ${cartao.fechamento}, vence dia ${cartao.vencimento}`,
  ].join("\n");
}
