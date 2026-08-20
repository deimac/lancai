import { CATEGORIAS_PADRAO, eh_categoria_sistema } from "@lancai/banco";
import type { Categoria } from "@lancai/banco";
import type { RepositorioContexto } from "./repositorio-contexto";

type RepositorioCategorias = Pick<RepositorioContexto, "listarCategorias" | "criarCategoria">;

/**
 * Primeiro uso: cria o catálogo padrão.
 * Se o usuário já tem categorias próprias, não recria padrão que foi
 * renomeada ou apagada — só garante as do sistema (Não classificado, fatura).
 */
export async function garantir_categorias_padrao(
  usuarioId: string,
  repositorio: RepositorioCategorias,
): Promise<Categoria[]> {
  const existentes = await repositorio.listarCategorias(usuarioId);
  const nomes = new Set(existentes.map((categoria) => categoria.nome.toLocaleLowerCase("pt-BR")));

  const temCatalogo = existentes.some((categoria) => !eh_categoria_sistema(categoria.nome));
  const aCriar = temCatalogo
    ? CATEGORIAS_PADRAO.filter((padrao) => eh_categoria_sistema(padrao.nome))
    : CATEGORIAS_PADRAO;

  for (const padrao of aCriar) {
    if (nomes.has(padrao.nome.toLocaleLowerCase("pt-BR"))) continue;
    await repositorio.criarCategoria(usuarioId, padrao.nome, padrao.tipo, padrao.icone, padrao.cor);
    nomes.add(padrao.nome.toLocaleLowerCase("pt-BR"));
  }

  return repositorio.listarCategorias(usuarioId);
}
