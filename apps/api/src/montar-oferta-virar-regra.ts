import type { PropostaRegra } from "@lancai/conhecimento";

/**
 * Oferta parseável após classificação manual (J9 / §9.3).
 * O interpretador de confirmação procura este padrão na última mensagem do sistema.
 */
export function montar_oferta_virar_regra(proposta: PropostaRegra): string {
  return `Quer transformar em regra? "${proposta.trecho} → ${proposta.categoriaNome}". Responda "sim" para criar ou "não" para pular.`;
}

export function texto_regra_criada(proposta: PropostaRegra): string {
  return `Regra criada: "${proposta.trecho} → ${proposta.categoriaNome}". Próximos lançamentos parecidos serão classificados sozinhos.`;
}

export function texto_regra_ja_existia(proposta: PropostaRegra): string {
  return `Essa regra já existia: "${proposta.trecho} → ${proposta.categoriaNome}".`;
}

export function texto_regra_recusada(): string {
  return "Ok, não criei a regra.";
}
