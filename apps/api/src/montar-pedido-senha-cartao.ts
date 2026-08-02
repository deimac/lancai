/** Texto padrão pedindo a senha antes de revelar dados do plástico. */
export function montar_pedido_senha_cartao(cartaoNome: string): string {
  return `Para ver os dados do cartão "${cartaoNome}", digite a senha da sua conta LançAI.`;
}

export function extrair_cartao_do_pedido_senha(conteudo: string): string | null {
  const match = /^Para ver os dados do cartão "([^"]+)", digite a senha da sua conta LançAI\.$/.exec(conteudo);
  return match?.[1] ?? null;
}
