import { and, eq, inArray } from "drizzle-orm";
import type { Banco } from "./cliente";
import { usuario as usuarioTabela, workspace, workspaceMembro } from "./schema";

/** ID sintético da visão agregada — não existe como linha em `workspace`. */
export const WORKSPACE_VISAO_GERAL = "geral" as const;

export type WorkspaceResumo = {
  id: string;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  sintetico?: boolean;
};

export type EscopoLeitura = {
  visaoAgregada: boolean;
  /** Workspace real para writes (sempre UUID válido após garantir). */
  workspaceAtivoId: string;
  /** Um id (visão normal) ou todos os workspaces do dono (Geral). */
  workspaceIds: string[];
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

async function ids_workspaces_dono(banco: Banco, usuarioId: string): Promise<string[]> {
  const linhas = await banco
    .select({ id: workspaceMembro.workspaceId })
    .from(workspaceMembro)
    .where(and(eq(workspaceMembro.usuarioId, usuarioId), eq(workspaceMembro.papel, "dono")));
  return linhas.map((linha) => linha.id);
}

/**
 * Resolve o workspace real do usuário para writes. Se não houver preferência válida,
 * usa o primeiro em que é dono; se não houver nenhum, cria "Principal".
 */
export async function garantir_workspace_do_usuario(
  banco: Banco,
  usuarioId: string,
  nome = "Principal",
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
    .values({ nome, tipo: "pessoal", descricao: null })
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

/** Escopo de leitura do cockpit: Geral (todos) ou um workspace real. */
export async function resolver_escopo_leitura(
  banco: Banco,
  usuarioId: string,
): Promise<EscopoLeitura> {
  const workspaceAtivoId = await garantir_workspace_do_usuario(banco, usuarioId);
  const [pref] = await banco
    .select({ visaoAgregada: usuarioTabela.visaoAgregada })
    .from(usuarioTabela)
    .where(eq(usuarioTabela.id, usuarioId))
    .limit(1);

  const visaoAgregada = pref?.visaoAgregada !== false;
  const todos = await ids_workspaces_dono(banco, usuarioId);

  return {
    visaoAgregada,
    workspaceAtivoId,
    workspaceIds: visaoAgregada ? todos : [workspaceAtivoId],
  };
}

export async function listar_workspaces_do_usuario(
  banco: Banco,
  usuarioId: string,
): Promise<WorkspaceResumo[]> {
  const escopo = await resolver_escopo_leitura(banco, usuarioId);

  const linhas = await banco
    .select({
      id: workspace.id,
      nome: workspace.nome,
      descricao: workspace.descricao,
    })
    .from(workspaceMembro)
    .innerJoin(workspace, eq(workspace.id, workspaceMembro.workspaceId))
    .where(and(eq(workspaceMembro.usuarioId, usuarioId), eq(workspaceMembro.papel, "dono")));

  const geral: WorkspaceResumo = {
    id: WORKSPACE_VISAO_GERAL,
    nome: "Geral",
    descricao: "Todas as contas e cartões",
    ativo: escopo.visaoAgregada,
    sintetico: true,
  };

  const reais = linhas.map((linha) => ({
    id: linha.id,
    nome: linha.nome,
    descricao: linha.descricao,
    ativo: !escopo.visaoAgregada && linha.id === escopo.workspaceAtivoId,
  }));

  return [geral, ...reais];
}

export async function criar_workspace_do_usuario(
  banco: Banco,
  usuarioId: string,
  entrada: { nome: string; descricao?: string | null },
): Promise<WorkspaceResumo> {
  await garantir_workspace_do_usuario(banco, usuarioId);

  const [criado] = await banco
    .insert(workspace)
    .values({
      nome: entrada.nome.trim(),
      descricao: entrada.descricao?.trim() || null,
      tipo: "pessoal",
    })
    .returning({ id: workspace.id, nome: workspace.nome, descricao: workspace.descricao });

  if (!criado) throw new Error("Não foi possível criar o workspace.");

  await banco.insert(workspaceMembro).values({
    workspaceId: criado.id,
    usuarioId,
    papel: "dono",
  });

  await banco
    .update(usuarioTabela)
    .set({
      workspaceAtivoId: criado.id,
      visaoAgregada: false,
      dataAtualizacao: new Date(),
    })
    .where(eq(usuarioTabela.id, usuarioId));

  return {
    id: criado.id,
    nome: criado.nome,
    descricao: criado.descricao,
    ativo: true,
  };
}

export async function definir_workspace_ativo(
  banco: Banco,
  usuarioId: string,
  workspaceId: string,
): Promise<WorkspaceResumo> {
  if (workspaceId === WORKSPACE_VISAO_GERAL) {
    await garantir_workspace_do_usuario(banco, usuarioId);
    await banco
      .update(usuarioTabela)
      .set({ visaoAgregada: true, dataAtualizacao: new Date() })
      .where(eq(usuarioTabela.id, usuarioId));

    return {
      id: WORKSPACE_VISAO_GERAL,
      nome: "Geral",
      descricao: "Todas as contas e cartões",
      ativo: true,
      sintetico: true,
    };
  }

  if (!(await membro_dono(banco, usuarioId, workspaceId))) {
    throw new ErroWorkspaceNaoEncontrado();
  }

  await banco
    .update(usuarioTabela)
    .set({
      workspaceAtivoId: workspaceId,
      visaoAgregada: false,
      dataAtualizacao: new Date(),
    })
    .where(eq(usuarioTabela.id, usuarioId));

  const [linha] = await banco
    .select({ id: workspace.id, nome: workspace.nome, descricao: workspace.descricao })
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
  dados: { nome?: string; descricao?: string | null },
): Promise<WorkspaceResumo> {
  if (workspaceId === WORKSPACE_VISAO_GERAL) {
    throw new ErroWorkspaceNaoEncontrado();
  }
  if (!(await membro_dono(banco, usuarioId, workspaceId))) {
    throw new ErroWorkspaceNaoEncontrado();
  }

  const valores: Partial<typeof workspace.$inferInsert> = { dataAtualizacao: new Date() };
  if (dados.nome != null) valores.nome = dados.nome.trim();
  if (dados.descricao !== undefined) {
    valores.descricao = dados.descricao?.trim() || null;
  }

  const [linha] = await banco
    .update(workspace)
    .set(valores)
    .where(eq(workspace.id, workspaceId))
    .returning({ id: workspace.id, nome: workspace.nome, descricao: workspace.descricao });

  if (!linha) throw new ErroWorkspaceNaoEncontrado();

  const escopo = await resolver_escopo_leitura(banco, usuarioId);
  return {
    ...linha,
    ativo: !escopo.visaoAgregada && linha.id === escopo.workspaceAtivoId,
  };
}

/** Nomes dos workspaces do dono — para enriquecer listagens. */
export async function mapear_nomes_workspaces(
  banco: Banco,
  workspaceIds: string[],
): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  if (workspaceIds.length === 0) return mapa;

  const linhas = await banco
    .select({ id: workspace.id, nome: workspace.nome })
    .from(workspace)
    .where(inArray(workspace.id, workspaceIds));

  for (const linha of linhas) mapa.set(linha.id, linha.nome);
  return mapa;
}

export class ErroWorkspaceNaoEncontrado extends Error {
  constructor() {
    super("Workspace não encontrado.");
    this.name = "ErroWorkspaceNaoEncontrado";
  }
}

export class ErroVisaoAgregadaSomenteLeitura extends Error {
  constructor() {
    super("Na visão Geral só é possível consultar. Escolha um workspace para cadastrar.");
    this.name = "ErroVisaoAgregadaSomenteLeitura";
  }
}
