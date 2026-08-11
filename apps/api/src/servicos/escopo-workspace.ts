import {
  listar_ids_workspaces_dono,
  obter_banco,
  resolver_escopo_leitura,
  type EscopoLeitura,
} from "@lancai/banco";

export async function obter_escopo_leitura(usuarioId: string): Promise<EscopoLeitura> {
  return resolver_escopo_leitura(obter_banco(), usuarioId);
}

/**
 * Todos os workspaces em que o usuário é dono — cadastro (conta/cartão/conexão)
 * pertence ao usuário; o workspace ativo só filtra relatórios.
 */
export async function obter_workspaces_do_usuario(usuarioId: string): Promise<string[]> {
  return listar_ids_workspaces_dono(obter_banco(), usuarioId);
}

/**
 * Workspace real onde creates (conta/cartão/OF) são gravados.
 * Na visão Geral, usa o `workspaceAtivoId` real (último workspace concreto do usuário).
 */
export async function exigir_workspace_escrita(usuarioId: string): Promise<string> {
  const escopo = await obter_escopo_leitura(usuarioId);
  return escopo.workspaceAtivoId;
}
