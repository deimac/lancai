/**
 * Meu Pluggy (conector 200) não é banco: o item nasce em meu.pluggy.ai.
 * No Connect widget ele só gera "erro inesperado".
 */
export function eh_conector_meu_pluggy(conector: {
  id?: number;
  name?: string | null;
}): boolean {
  if (conector.id === 200) return true;
  return /meu\s*pluggy/i.test(conector.name ?? "");
}

export function ids_conectores_para_widget(
  conectores: Array<{ id: number; name?: string | null }>,
): number[] {
  return conectores.filter((c) => !eh_conector_meu_pluggy(c)).map((c) => c.id);
}
