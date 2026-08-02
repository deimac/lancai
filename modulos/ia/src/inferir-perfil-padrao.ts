import type { Perfil } from "@lancai/tipos";

/**
 * Quando o usuário só tem contas/cartões de um perfil (só PF ou só PJ), esse
 * perfil vira o padrão — não é obrigatório ter cadastro da empresa para usar
 * o app, nem o contrário.
 */
export function inferir_perfil_padrao(
  contas: Array<{ perfil: string }>,
  cartoes: Array<{ perfil: string }> = [],
): Perfil | null {
  const perfis = new Set(
    [...contas, ...cartoes].map((item) => item.perfil).filter((perfil) => perfil === "pf" || perfil === "pj"),
  );
  if (perfis.size !== 1) return null;
  return [...perfis][0] as Perfil;
}
