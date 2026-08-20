const CHAVE = "lancai.sidebar.recolhida";

export function ler_sidebar_recolhida(): boolean {
  try {
    return localStorage.getItem(CHAVE) === "true";
  } catch {
    return false;
  }
}

export function salvar_sidebar_recolhida(recolhida: boolean): void {
  try {
    localStorage.setItem(CHAVE, String(recolhida));
  } catch {
    /* ignore */
  }
}
