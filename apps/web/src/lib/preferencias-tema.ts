export type TemaLancai = "escuro" | "claro";

const CHAVE = "lancai.tema";

export function ler_tema(): TemaLancai {
  try {
    const salvo = localStorage.getItem(CHAVE);
    if (salvo === "claro" || salvo === "escuro") return salvo;
  } catch {
    /* ignore */
  }
  return "escuro";
}

export function aplicar_tema(tema: TemaLancai): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.tema = tema;
}

export function salvar_tema(tema: TemaLancai): void {
  try {
    localStorage.setItem(CHAVE, tema);
  } catch {
    /* ignore */
  }
  aplicar_tema(tema);
}

export function alternar_tema(atual: TemaLancai): TemaLancai {
  return atual === "escuro" ? "claro" : "escuro";
}
