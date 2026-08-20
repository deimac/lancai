import { CATEGORIAS_PADRAO } from "@lancai/banco";
import type { Categoria } from "@lancai/banco";
import type { RepositorioContexto } from "./repositorio-contexto";

type RepositorioCategorias = Pick<RepositorioContexto, "listarCategorias" | "criarCategoria">;

/**
 * Garante as categorias padrão do produto para o usuário (idempotente).
 * Uma lista por usuário — o mesmo id vale em todos os workspaces.
 * Chamado no primeiro uso do chat / listagem de categorias.
 */
export async function garantir_categorias_padrao(
  usuarioId: string,
  repositorio: RepositorioCategorias,
): Promise<Categoria[]> {
  const existentes = await repositorio.listarCategorias(usuarioId);
  const nomes = new Set(existentes.map((categoria) => categoria.nome.toLocaleLowerCase("pt-BR")));

  for (const padrao of CATEGORIAS_PADRAO) {
    if (nomes.has(padrao.nome.toLocaleLowerCase("pt-BR"))) continue;
    await repositorio.criarCategoria(usuarioId, padrao.nome, padrao.tipo, padrao.icone, padrao.cor);
    nomes.add(padrao.nome.toLocaleLowerCase("pt-BR"));
  }

  return repositorio.listarCategorias(usuarioId);
}
