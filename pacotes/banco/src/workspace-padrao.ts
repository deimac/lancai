import { and, eq } from "drizzle-orm";
import type { Banco } from "./cliente";
import { workspace, workspaceMembro } from "./schema";

/**
 * Até a fase F6 cada usuário tem exatamente um workspace, criado sob demanda.
 * Quando a interface de workspaces existir, esta função sai de cena e o
 * workspace passa a ser escolhido explicitamente. Ver ADR-013.
 */
export async function garantir_workspace_do_usuario(
  banco: Banco,
  usuarioId: string,
  nome = "Pessoal",
): Promise<string> {
  const [existente] = await banco
    .select({ id: workspaceMembro.workspaceId })
    .from(workspaceMembro)
    .where(and(eq(workspaceMembro.usuarioId, usuarioId), eq(workspaceMembro.papel, "dono")))
    .limit(1);

  if (existente) return existente.id;

  const [criado] = await banco
    .insert(workspace)
    .values({ nome, tipo: "pessoal" })
    .returning({ id: workspace.id });

  if (!criado) {
    throw new Error("Não foi possível criar o workspace padrão do usuário.");
  }

  await banco
    .insert(workspaceMembro)
    .values({ workspaceId: criado.id, usuarioId, papel: "dono" });

  return criado.id;
}
