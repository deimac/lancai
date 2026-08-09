import {
  ErroVisaoAgregadaSomenteLeitura,
  obter_banco,
  resolver_escopo_leitura,
  type EscopoLeitura,
} from "@lancai/banco";

export async function obter_escopo_leitura(usuarioId: string): Promise<EscopoLeitura> {
  return resolver_escopo_leitura(obter_banco(), usuarioId);
}

/** Para creates (conta/cartão/OF): exige visão de um workspace real. */
export async function exigir_workspace_escrita(usuarioId: string): Promise<string> {
  const escopo = await obter_escopo_leitura(usuarioId);
  if (escopo.visaoAgregada) {
    throw new ErroVisaoAgregadaSomenteLeitura();
  }
  return escopo.workspaceAtivoId;
}
