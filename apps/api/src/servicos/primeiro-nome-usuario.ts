import { eq } from "drizzle-orm";
import { obter_banco, usuario as usuarioTabela } from "@lancai/banco";

const RAZAO_SOCIAL = /\b(ltda\.?|eireli|mei|s\.?a\.?|s\/a|sociedade)\b|\bME\b/i;

export async function banco_usuario_nome(usuarioId: string): Promise<string | null> {
  const banco = obter_banco();
  const [linha] = await banco
    .select({ nome: usuarioTabela.nome })
    .from(usuarioTabela)
    .where(eq(usuarioTabela.id, usuarioId))
    .limit(1);
  return linha?.nome ?? null;
}

/** Primeiro token do cadastro, se parecer nome de pessoa. Razão social → undefined. */
export function primeiroNomeVocativo(nome: string | null | undefined): string | undefined {
  if (!nome) return undefined;
  const t = nome.trim();
  if (!t) return undefined;
  if (RAZAO_SOCIAL.test(t.normalize("NFD").replace(/\p{M}/gu, ""))) return undefined;
  const primeiro = t.split(/\s+/)[0];
  if (!primeiro || primeiro.length < 2 || /^\d+$/.test(primeiro)) return undefined;
  return primeiro;
}

export async function primeiroNomeDoUsuario(usuarioId: string): Promise<string | undefined> {
  return primeiroNomeVocativo(await banco_usuario_nome(usuarioId));
}
