import type { PosicaoPainel } from "@lancai/tipos";

export type { PosicaoPainel };

const CHAVE_POSICAO = "lancai.painel.posicao";
const CHAVE_EXPANDIDO = "lancai.painel.expandido";
const CHAVE_LARGURA = "lancai.painel.largura";
const CHAVE_ALTURA = "lancai.painel.altura";
const CHAVE_MAXIMIZADO = "lancai.painel.maximizado";

export const LARGURA_PAINEL_MIN = 320;
export const LARGURA_PAINEL_PADRAO = 380;
export const ALTURA_PAINEL_MIN = 220;
export const RESERVA_CONTEUDO_LATERAL_PX = 48;
export const RESERVA_CONTEUDO_INFERIOR_PX = 48;
const FRACAO_ALTURA_PADRAO = 0.42;

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

export function limitar_px(valor: number, min: number, max: number): number {
  if (!Number.isFinite(valor)) return min;
  const teto = Number.isFinite(max) ? Math.max(min, max) : min;
  return Math.min(Math.max(Math.round(valor), min), teto);
}

export function limitar_largura_painel(px: number, larguraDisponivel: number): number {
  return limitar_px(px, LARGURA_PAINEL_MIN, larguraDisponivel - RESERVA_CONTEUDO_LATERAL_PX);
}

export function limitar_altura_painel(px: number, alturaDisponivel: number): number {
  return limitar_px(px, ALTURA_PAINEL_MIN, alturaDisponivel - RESERVA_CONTEUDO_INFERIOR_PX);
}

export function altura_painel_padrao(viewportAltura: number): number {
  const bruto = Number.isFinite(viewportAltura) ? viewportAltura * FRACAO_ALTURA_PADRAO : ALTURA_PAINEL_MIN;
  return Math.max(ALTURA_PAINEL_MIN, Math.round(bruto));
}

function ler_numero(chave: string): number | null {
  try {
    const salvo = localStorage.getItem(chave);
    if (salvo == null) return null;
    const n = Number.parseInt(salvo, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function ler_largura_painel(): number {
  return ler_numero(CHAVE_LARGURA) ?? LARGURA_PAINEL_PADRAO;
}

export function salvar_largura_painel(px: number): void {
  try {
    localStorage.setItem(CHAVE_LARGURA, String(Math.round(px)));
  } catch {
    /* ignore */
  }
}

export function ler_altura_painel(viewportAltura = typeof window === "undefined" ? 800 : window.innerHeight): number {
  return ler_numero(CHAVE_ALTURA) ?? altura_painel_padrao(viewportAltura);
}

export function salvar_altura_painel(px: number): void {
  try {
    localStorage.setItem(CHAVE_ALTURA, String(Math.round(px)));
  } catch {
    /* ignore */
  }
}

export function ler_painel_maximizado(): boolean {
  try {
    return localStorage.getItem(CHAVE_MAXIMIZADO) === "true";
  } catch {
    return false;
  }
}

export function salvar_painel_maximizado(maximizado: boolean): void {
  try {
    localStorage.setItem(CHAVE_MAXIMIZADO, String(maximizado));
  } catch {
    /* ignore */
  }
}
