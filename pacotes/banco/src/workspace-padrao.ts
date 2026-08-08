import { and, eq } from "drizzle-orm";
import type { Banco } from "./cliente";
import { usuario as usuarioTabela, workspace, workspaceMembro } from "./schema";

export type TipoWorkspaceCadastro = "pessoal" | "empresa";

export type WorkspaceResumo = {
  id: string;
  nome: string;
  tipo: TipoWorkspaceCadastro;
  ativo: boolean;
};

async function membro_dono(banco: Banco, usuarioId: string, workspaceId: string) {
  const [membro] = await banco
    .select({ id: workspaceMembro.id })
    .from(workspaceMembro)
    .where(
      and(
        eq(workspaceMembro.usuarioId, usuarioId),
        eq(workspaceMembro.workspaceId, workspaceId),
        eq(workspaceMembro.papel, "dono"),
      ),
    )
    .limit(1);
  return Boolean(membro);
}

/**
 * Resolve o workspace ativo do usuário. Se não houver preferência válida,
 * usa o primeiro em que é dono; se não houver nenhum, cria "Pessoal".
 */
export async function garantir_workspace_do_usuario(
  banco: Banco,
  usuarioId: string,
  nome = "Pessoal",
): Promise<string> {
  const [pref] = await banco
    .select({ workspaceAtivoId: usuarioTabela.workspaceAtivoId })
    .from(usuarioTabela)
    .where(eq(usuarioTabela.id, usuarioId))
    .limit(1);

  if (pref?.workspaceAtivoId && (await membro_dono(banco, usuarioId, pref.workspaceAtivoId))) {
    return pref.workspaceAtivoId;
  }

  const [existente] = await banco
    .select({ id: workspaceMembro.workspaceId })
    .from(workspaceMembro)
    .where(and(eq(workspaceMembro.usuarioId, usuarioId), eq(workspaceMembro.papel, "dono")))
    .limit(1);

  if (existente) {
    await banco
      .update(usuarioTabela)
      .set({ workspaceAtivoId: existente.id, dataAtualizacao: new Date() })
      .where(eq(usuarioTabela.id, usuarioId));
    return existente.id;
  }

  const [criado] = await banco
    .insert(workspace)
    .values({ nome, tipo: "pessoal" })
    .returning({ id: workspace.id });

  if (!criado) {
    throw new Error("Não foi possível criar o workspace padrão do usuário.");
  }

  await banco.insert(workspaceMembro).values({
    workspaceId: criado.id,
    usuarioId,
    papel: "dono",
  });

  await banco
    .update(usuarioTabela)
    .set({ workspaceAtivoId: criado.id, dataAtualizacao: new Date() })
    .where(eq(usuarioTabela.id, usuarioId));

  return criado.id;
}

export async function listar_workspaces_do_usuario(
  banco: Banco,
  usuarioId: string,
): Promise<WorkspaceResumo[]> {
  const ativoId = await garantir_workspace_do_usuario(banco, usuarioId);

  const linhas = await banco
    .select({
      id: workspace.id,
      nome: workspace.nome,
      tipo: workspace.tipo,
    })
    .from(workspaceMembro)
    .innerJoin(workspace, eq(workspace.id, workspaceMembro.workspaceId))
    .where(and(eq(workspaceMembro.usuarioId, usuarioId), eq(workspaceMembro.papel, "dono")));

  return linhas.map((linha) => ({
    id: linha.id,
    nome: linha.nome,
    tipo: linha.tipo,
    ativo: linha.id === ativoId,
  }));
}

export async function criar_workspace_do_usuario(
  banco: Banco,
  usuarioId: string,
  entrada: { nome: string; tipo: TipoWorkspaceCadastro },
): Promise<WorkspaceResumo> {
  await garantir_workspace_do_usuario(banco, usuarioId);

  const [criado] = await banco
    .insert(workspace)
    .values({ nome: entrada.nome.trim(), tipo: entrada.tipo })
    .returning({ id: workspace.id, nome: workspace.nome, tipo: workspace.tipo });

  if (!criado) throw new Error("Não foi possível criar o workspace.");

  await banco.insert(workspaceMembro).values({
    workspaceId: criado.id,
    usuarioId,
    papel: "dono",
  });

  await banco
    .update(usuarioTabela)
    .set({ workspaceAtivoId: criado.id, dataAtualizacao: new Date() })
    .where(eq(usuarioTabela.id, usuarioId));

  return { id: criado.id, nome: criado.nome, tipo: criado.tipo, ativo: true };
}

export async function definir_workspace_ativo(
  banco: Banco,
  usuarioId: string,
  workspaceId: string,
): Promise<WorkspaceResumo> {
  if (!(await membro_dono(banco, usuarioId, workspaceId))) {
    throw new ErroWorkspaceNaoEncontrado();
  }

  await banco
    .update(usuarioTabela)
    .set({ workspaceAtivoId: workspaceId, dataAtualizacao: new Date() })
    .where(eq(usuarioTabela.id, usuarioId));

  const [linha] = await banco
    .select({ id: workspace.id, nome: workspace.nome, tipo: workspace.tipo })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);

  if (!linha) throw new ErroWorkspaceNaoEncontrado();
  return { ...linha, ativo: true };
}

export async function atualizar_workspace_do_usuario(
  banco: Banco,
  usuarioId: string,
  workspaceId: string,
  dados: { nome?: string; tipo?: TipoWorkspaceCadastro },
): Promise<WorkspaceResumo> {
  if (!(await membro_dono(banco, usuarioId, workspaceId))) {
    throw new ErroWorkspaceNaoEncontrado();
  }

  const valores: Partial<typeof workspace.$inferInsert> = { dataAtualizacao: new Date() };
  if (dados.nome != null) valores.nome = dados.nome.trim();
  if (dados.tipo != null) valores.tipo = dados.tipo;

  const [linha] = await banco
    .update(workspace)
    .set(valores)
    .where(eq(workspace.id, workspaceId))
    .returning({ id: workspace.id, nome: workspace.nome, tipo: workspace.tipo });

  if (!linha) throw new ErroWorkspaceNaoEncontrado();

  const ativoId = await garantir_workspace_do_usuario(banco, usuarioId);
  return { ...linha, ativo: linha.id === ativoId };
}

export class ErroWorkspaceNaoEncontrado extends Error {
  constructor() {
    super("Workspace não encontrado.");
    this.name = "ErroWorkspaceNaoEncontrado";
  }
}
