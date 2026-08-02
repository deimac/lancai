import type { MensagemHistorico } from "@lancai/ia";
import { extrair_cartao_do_pedido_senha } from "./montar-pedido-senha-cartao";

const TEXTO_SENHA_OMITIDA = "[senha omitida]";

/** Evita tratar "sim"/"não"/menu como senha. */
const NAO_E_SENHA = /^(sim|não|nao|confirmo|cancela|cancelar|menu|ajuda|help|ok|yes|no)\.?$/i;

export function extrair_pendencia_senha_cartao(historicoRecente: MensagemHistorico[]): string | null {
  for (let i = historicoRecente.length - 1; i >= 0; i -= 1) {
    const mensagem = historicoRecente[i];
    if (mensagem?.papel !== "sistema") continue;
    return extrair_cartao_do_pedido_senha(mensagem.conteudo);
  }
  return null;
}

export function mensagem_parece_senha(mensagem: string): boolean {
  const texto = mensagem.trim();
  if (!texto || texto.length > 128) return false;
  if (NAO_E_SENHA.test(texto)) return false;
  // Pedidos longos em linguagem natural não são senha.
  if (/\s{2,}/.test(texto) || texto.split(/\s+/).length > 4) return false;
  return true;
}

export function redigir_senha_no_historico(): string {
  return TEXTO_SENHA_OMITIDA;
}

export { TEXTO_SENHA_OMITIDA };
