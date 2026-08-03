import type { FormaPagamento } from "@lancai/tipos";

/**
 * Infere a forma de pagamento a partir da mensagem do usuário.
 * Retorna null quando não há pista clara (não deve gerar pergunta).
 */
export function inferir_forma_pagamento_da_mensagem(mensagem: string): FormaPagamento | null {
  const texto = mensagem.toLocaleLowerCase("pt-BR");

  if (/\b(no\s+d[eé]bito|cart[aã]o\s+de\s+d[eé]bito|d[eé]bito)\b/.test(texto)) {
    return "debito";
  }
  if (/\b(no\s+cr[eé]dito|cart[aã]o\s+de\s+cr[eé]dito|cr[eé]dito)\b/.test(texto)) {
    return "credito";
  }
  if (/\bpix\b/.test(texto)) return "pix";
  if (/\b(ted|doc|transfer[eê]ncia|transf\.?)\b/.test(texto)) return "transferencia";
  if (/\bboleto\b/.test(texto)) return "boleto";
  if (/\b(dinheiro|esp[eé]cie|em\s+m[aã]os)\b/.test(texto)) return "dinheiro";

  return null;
}

/** Detecta pedido explícito de cartão só de débito no cadastro. */
export function mensagem_pede_cartao_debito(mensagem: string): boolean {
  const texto = mensagem.toLocaleLowerCase("pt-BR");
  return /\b(cart[aã]o\s+de\s+d[eé]bito|s[oó]\s+d[eé]bito|d[eé]bito\s+puro)\b/.test(texto);
}
