import type { PosicaoPainel } from "@lancai/tipos";

export type { PosicaoPainel };

const CHAVE_POSICAO = "lancai.painel.posicao";
const CHAVE_EXPANDIDO = "lancai.painel.expandido";

function eh_mobile(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 767px)").matches;
}

export function ler_posicao_painel(): PosicaoPainel {
  try {
    const salvo = localStorage.getItem(CHAVE_POSICAO);
    if (salvo === "lateral" || salvo === "inferior") return salvo;
  } catch {
    /* ignore */
  }
  return eh_mobile() ? "inferior" : "lateral";
}

export function salvar_posicao_painel(posicao: PosicaoPainel): void {
  try {
    localStorage.setItem(CHAVE_POSICAO, posicao);
  } catch {
    /* ignore */
  }
}

/**
 * Fonte da verdade é o backend; localStorage é cache rápido / offline.
 * Preferência do usuário > cache local > padrão por viewport.
 */
export function resolver_posicao_painel(doServidor: PosicaoPainel | null | undefined): PosicaoPainel {
  if (doServidor === "lateral" || doServidor === "inferior") return doServidor;
  return ler_posicao_painel();
}

export function ler_painel_expandido(): boolean {
  try {
    const salvo = localStorage.getItem(CHAVE_EXPANDIDO);
    if (salvo === "true") return true;
    if (salvo === "false") return false;
  } catch {
    /* ignore */
  }
  return !eh_mobile();
}

export function salvar_painel_expandido(expandido: boolean): void {
  try {
    localStorage.setItem(CHAVE_EXPANDIDO, String(expandido));
  } catch {
    /* ignore */
  }
}
