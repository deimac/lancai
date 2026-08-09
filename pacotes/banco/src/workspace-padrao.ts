import { and, count, eq, inArray } from "drizzle-orm";
import type { Banco } from "./cliente";
import {
  cartao as cartaoTabela,
  categoria as categoriaTabela,
  conta as contaTabela,
  memoria as memoriaTabela,
  movimento as movimentoTabela,
  openFinanceConexao as conexaoTabela,
  orcamento as orcamentoTabela,
  pessoa as pessoaTabela,
  recorrencia as recorrenciaTabela,
  regra as regraTabela,
  usuario as usuarioTabela,
  workspace,
  workspaceMembro,
} from "./schema";

/** ID sintético da visão agregada — não existe como linha em `workspace`. */
export const WORKSPACE_VISAO_GERAL = "geral" as const;

export const CORES_WORKSPACE = [
  "violet",
  "blue",
  "teal",
  "orange",
  "red",
  "pink",
  "indigo",
  "slate",
] as const;

export type CorWorkspace = (typeof CORES_WORKSPACE)[number];

export type WorkspaceResumo = {
  id: string;
  nome: string;
  descricao: string | null;
  cor: string;
  ativo: boolean;
  sintetico?: boolean;
  quantidadeContas?: number;
  quantidadeCartoes?: number;
};

export type EscopoLeitura = {
  visaoAgregada: boolean;
  workspaceAtivoId: string;
  workspaceIds: string[];
};

function cor_valida(cor: string | null | undefined): CorWorkspace {
  if (cor && (CORES_WORKSPACE as readonly string[]).includes(cor)) {
    return cor as CorWorkspace;
  }
  return "violet";
}

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

/** Workspaces em que o usuário é dono — escopo das regras gerais do usuário. */
export async function listar_ids_workspaces_dono(
  banco: Banco,
  usuarioId: string,
): Promise<string[]> {
  const linhas = await banco
    .select({ id: workspaceMembro.workspaceId })
    .from(workspaceMembro)
    .where(and(eq(workspaceMembro.usuarioId, usuarioId), eq(workspaceMembro.papel, "dono")));
  return linhas.map((linha) => linha.id);
}

async function ids_workspaces_dono(banco: Banco, usuarioId: string): Promise<string[]> {
  return listar_ids_workspaces_dono(banco, usuarioId);
}

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
    .values({ nome, descricao: null, cor: "violet" })
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

/** Workspace "Principal" do dono — destino ao desmarcar membros / ao excluir outro WS. */
export async function resolver_workspace_principal(
  banco: Banco,
  usuarioId: string,
): Promise<string> {
  const ids = await ids_workspaces_dono(banco, usuarioId);
  if (ids.length === 0) {
    return garantir_workspace_do_usuario(banco, usuarioId);
  }

  const linhas = await banco
    .select({ id: workspace.id, nome: workspace.nome })
    .from(workspace)
    .where(inArray(workspace.id, ids));

  const principal = linhas.find((l) => l.nome === "Principal") ?? linhas[0];
  if (!principal) return garantir_workspace_do_usuario(banco, usuarioId);
  return principal.id;
}

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

async function contar_por_workspace(
  banco: Banco,
  usuarioId: string,
  workspaceIds: string[],
): Promise<{ contas: Map<string, number>; cartoes: Map<string, number> }> {
  const contas = new Map<string, number>();
  const cartoes = new Map<string, number>();
  if (workspaceIds.length === 0) return { contas, cartoes };

  // Mesmo critério do modal: só ativos do dono.
  const linhasConta = await banco
    .select({ workspaceId: contaTabela.workspaceId, total: count() })
    .from(contaTabela)
    .where(
      and(
        eq(contaTabela.usuarioId, usuarioId),
        inArray(contaTabela.workspaceId, workspaceIds),
        eq(contaTabela.ativo, true),
      ),
    )
    .groupBy(contaTabela.workspaceId);

  for (const linha of linhasConta) contas.set(linha.workspaceId, Number(linha.total));

  const linhasCartao = await banco
    .select({ workspaceId: cartaoTabela.workspaceId, total: count() })
    .from(cartaoTabela)
    .where(
      and(
        eq(cartaoTabela.usuarioId, usuarioId),
        inArray(cartaoTabela.workspaceId, workspaceIds),
        eq(cartaoTabela.ativo, true),
      ),
    )
    .groupBy(cartaoTabela.workspaceId);

  for (const linha of linhasCartao) cartoes.set(linha.workspaceId, Number(linha.total));

  return { contas, cartoes };
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
      cor: workspace.cor,
    })
    .from(workspaceMembro)
    .innerJoin(workspace, eq(workspace.id, workspaceMembro.workspaceId))
    .where(and(eq(workspaceMembro.usuarioId, usuarioId), eq(workspaceMembro.papel, "dono")));

  const ids = linhas.map((l) => l.id);
  const totais = await contar_por_workspace(banco, usuarioId, ids);

  const geral: WorkspaceResumo = {
    id: WORKSPACE_VISAO_GERAL,
    nome: "Geral",
    descricao: "Todas as contas e cartões",
    cor: "slate",
    ativo: escopo.visaoAgregada,
    sintetico: true,
  };

  const reais = linhas.map((linha) => ({
    id: linha.id,
    nome: linha.nome,
    descricao: linha.descricao,
    cor: linha.cor,
    ativo: !escopo.visaoAgregada && linha.id === escopo.workspaceAtivoId,
    quantidadeContas: totais.contas.get(linha.id) ?? 0,
    quantidadeCartoes: totais.cartoes.get(linha.id) ?? 0,
  }));

  return [geral, ...reais];
}

export async function criar_workspace_do_usuario(
  banco: Banco,
  usuarioId: string,
  entrada: { nome: string; descricao?: string | null; cor?: string | null },
): Promise<WorkspaceResumo> {
  await garantir_workspace_do_usuario(banco, usuarioId);

  const [criado] = await banco
    .insert(workspace)
    .values({
      nome: entrada.nome.trim(),
      descricao: entrada.descricao?.trim() || null,
      cor: cor_valida(entrada.cor),
    })
    .returning({
      id: workspace.id,
      nome: workspace.nome,
      descricao: workspace.descricao,
      cor: workspace.cor,
    });

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
    cor: criado.cor,
    ativo: true,
    quantidadeContas: 0,
    quantidadeCartoes: 0,
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
      cor: "slate",
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
    .select({
      id: workspace.id,
      nome: workspace.nome,
      descricao: workspace.descricao,
      cor: workspace.cor,
    })
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
  dados: { nome?: string; descricao?: string | null; cor?: string | null },
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
  if (dados.cor !== undefined && dados.cor !== null) {
    valores.cor = cor_valida(dados.cor);
  }

  const [linha] = await banco
    .update(workspace)
    .set(valores)
    .where(eq(workspace.id, workspaceId))
    .returning({
      id: workspace.id,
      nome: workspace.nome,
      descricao: workspace.descricao,
      cor: workspace.cor,
    });

  if (!linha) throw new ErroWorkspaceNaoEncontrado();

  const escopo = await resolver_escopo_leitura(banco, usuarioId);
  const totais = await contar_por_workspace(banco, usuarioId, [linha.id]);
  return {
    ...linha,
    ativo: !escopo.visaoAgregada && linha.id === escopo.workspaceAtivoId,
    quantidadeContas: totais.contas.get(linha.id) ?? 0,
    quantidadeCartoes: totais.cartoes.get(linha.id) ?? 0,
  };
}

/**
 * Define quais contas/cartões pertencem ao workspace.
 * Selecionados → este workspace; os que estavam aqui e saíram → Principal (se diferente).
 */
export async function definir_membros_workspace(
  banco: Banco,
  usuarioId: string,
  workspaceId: string,
  entrada: { contaIds: string[]; cartaoIds: string[] },
): Promise<WorkspaceResumo> {
  if (workspaceId === WORKSPACE_VISAO_GERAL) {
    throw new ErroWorkspaceNaoEncontrado();
  }
  if (!(await membro_dono(banco, usuarioId, workspaceId))) {
    throw new ErroWorkspaceNaoEncontrado();
  }
  if (entrada.contaIds.length + entrada.cartaoIds.length < 1) {
    throw new ErroWorkspaceSemMembros();
  }

  const principalId = await resolver_workspace_principal(banco, usuarioId);
  const agora = new Date();

  const contasDoUsuario = await banco
    .select({ id: contaTabela.id, workspaceId: contaTabela.workspaceId })
    .from(contaTabela)
    .where(and(eq(contaTabela.usuarioId, usuarioId), eq(contaTabela.ativo, true)));

  const setContas = new Set(entrada.contaIds);
  for (const id of setContas) {
    if (!contasDoUsuario.some((c) => c.id === id)) {
      throw new ErroWorkspaceMembroInvalido();
    }
  }

  for (const conta of contasDoUsuario) {
    const selecionada = setContas.has(conta.id);
    if (selecionada && conta.workspaceId !== workspaceId) {
      await banco
        .update(contaTabela)
        .set({ workspaceId, dataAtualizacao: agora })
        .where(eq(contaTabela.id, conta.id));
    } else if (
      !selecionada &&
      conta.workspaceId === workspaceId &&
      workspaceId !== principalId
    ) {
      await banco
        .update(contaTabela)
        .set({ workspaceId: principalId, dataAtualizacao: agora })
        .where(eq(contaTabela.id, conta.id));
    }
  }

  const cartoesDoUsuario = await banco
    .select({ id: cartaoTabela.id, workspaceId: cartaoTabela.workspaceId })
    .from(cartaoTabela)
    .where(and(eq(cartaoTabela.usuarioId, usuarioId), eq(cartaoTabela.ativo, true)));

  const setCartoes = new Set(entrada.cartaoIds);
  for (const id of setCartoes) {
    if (!cartoesDoUsuario.some((c) => c.id === id)) {
      throw new ErroWorkspaceMembroInvalido();
    }
  }

  for (const cartao of cartoesDoUsuario) {
    const selecionado = setCartoes.has(cartao.id);
    if (selecionado && cartao.workspaceId !== workspaceId) {
      await banco
        .update(cartaoTabela)
        .set({ workspaceId, dataAtualizacao: agora })
        .where(eq(cartaoTabela.id, cartao.id));
    } else if (
      !selecionado &&
      cartao.workspaceId === workspaceId &&
      workspaceId !== principalId
    ) {
      await banco
        .update(cartaoTabela)
        .set({ workspaceId: principalId, dataAtualizacao: agora })
        .where(eq(cartaoTabela.id, cartao.id));
    }
  }

  // Itens ativos no Principal: se este workspace NÃO é o Principal, ok.
  // Se ESTE é o Principal, desmarcar não remove (não há outro destino).
  // Para workspaces não-Principal, também tira contas/cartões inativos órfãos.
  if (workspaceId !== principalId) {
    await banco
      .update(contaTabela)
      .set({ workspaceId: principalId, dataAtualizacao: agora })
      .where(
        and(
          eq(contaTabela.usuarioId, usuarioId),
          eq(contaTabela.workspaceId, workspaceId),
          eq(contaTabela.ativo, false),
        ),
      );
    await banco
      .update(cartaoTabela)
      .set({ workspaceId: principalId, dataAtualizacao: agora })
      .where(
        and(
          eq(cartaoTabela.usuarioId, usuarioId),
          eq(cartaoTabela.workspaceId, workspaceId),
          eq(cartaoTabela.ativo, false),
        ),
      );
  }

  return atualizar_workspace_do_usuario(banco, usuarioId, workspaceId, {});
}

async function reatribuir_tudo(
  banco: Banco,
  de: string,
  para: string,
): Promise<void> {
  if (de === para) return;
  const agora = new Date();
  await banco.update(contaTabela).set({ workspaceId: para, dataAtualizacao: agora }).where(eq(contaTabela.workspaceId, de));
  await banco.update(cartaoTabela).set({ workspaceId: para, dataAtualizacao: agora }).where(eq(cartaoTabela.workspaceId, de));
  await banco.update(conexaoTabela).set({ workspaceId: para }).where(eq(conexaoTabela.workspaceId, de));
  await banco.update(movimentoTabela).set({ workspaceId: para }).where(eq(movimentoTabela.workspaceId, de));
  await banco.update(categoriaTabela).set({ workspaceId: para }).where(eq(categoriaTabela.workspaceId, de));
  await banco.update(pessoaTabela).set({ workspaceId: para }).where(eq(pessoaTabela.workspaceId, de));
  await banco.update(regraTabela).set({ workspaceId: para }).where(eq(regraTabela.workspaceId, de));
  await banco.update(memoriaTabela).set({ workspaceId: para }).where(eq(memoriaTabela.workspaceId, de));
  await banco.update(orcamentoTabela).set({ workspaceId: para }).where(eq(orcamentoTabela.workspaceId, de));
  await banco
    .update(recorrenciaTabela)
    .set({ workspaceId: para })
    .where(eq(recorrenciaTabela.workspaceId, de));
}

export async function excluir_workspace_do_usuario(
  banco: Banco,
  usuarioId: string,
  workspaceId: string,
): Promise<void> {
  if (workspaceId === WORKSPACE_VISAO_GERAL) {
    throw new ErroWorkspaceNaoEncontrado();
  }
  if (!(await membro_dono(banco, usuarioId, workspaceId))) {
    throw new ErroWorkspaceNaoEncontrado();
  }

  const ids = await ids_workspaces_dono(banco, usuarioId);
  if (ids.length <= 1) {
    throw new ErroWorkspaceNaoPodeExcluir("Não é possível excluir o único workspace.");
  }

  const principalId = await resolver_workspace_principal(banco, usuarioId);
  const destino = principalId === workspaceId
    ? (ids.find((id) => id !== workspaceId) ?? null)
    : principalId;

  if (!destino) {
    throw new ErroWorkspaceNaoPodeExcluir("Não há outro workspace para receber as contas.");
  }

  await reatribuir_tudo(banco, workspaceId, destino);

  const [pref] = await banco
    .select({ workspaceAtivoId: usuarioTabela.workspaceAtivoId })
    .from(usuarioTabela)
    .where(eq(usuarioTabela.id, usuarioId))
    .limit(1);

  if (pref?.workspaceAtivoId === workspaceId) {
    await banco
      .update(usuarioTabela)
      .set({ workspaceAtivoId: destino, dataAtualizacao: new Date() })
      .where(eq(usuarioTabela.id, usuarioId));
  }

  await banco
    .delete(workspaceMembro)
    .where(and(eq(workspaceMembro.workspaceId, workspaceId), eq(workspaceMembro.usuarioId, usuarioId)));

  await banco.delete(workspace).where(eq(workspace.id, workspaceId));
}

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

export class ErroWorkspaceNaoPodeExcluir extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroWorkspaceNaoPodeExcluir";
  }
}

export class ErroWorkspaceSemMembros extends Error {
  constructor() {
    super("Selecione ao menos uma conta ou cartão.");
    this.name = "ErroWorkspaceSemMembros";
  }
}

export class ErroWorkspaceMembroInvalido extends Error {
  constructor() {
    super("Conta ou cartão inválido para este usuário.");
    this.name = "ErroWorkspaceMembroInvalido";
  }
}
