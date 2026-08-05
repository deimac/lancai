import type { Memoria } from "@lancai/memoria";
import type { EntradaCriarMovimento } from "@lancai/tipos";

function slug_estabelecimento(descricao: string): string {
  return descricao
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
}

/**
 * Aprende hábitos determinísticos após lançamento bem-sucedido (ADR-003: não é a IA que grava).
 */
export async function aprender_habitos_apos_lancamento(
  memoria: Memoria,
  usuarioId: string,
  entrada: EntradaCriarMovimento,
  nomes: { contaNome?: string | null; cartaoNome?: string | null; categoriaNome?: string | null },
): Promise<void> {
  if (nomes.cartaoNome?.trim()) {
    await memoria.salvar_habito(usuarioId, "cartao_principal", nomes.cartaoNome.trim());
  }
  if (nomes.contaNome?.trim() && entrada.tipo !== "transferencia") {
    await memoria.salvar_habito(usuarioId, "conta_principal", nomes.contaNome.trim());
  }
  if (nomes.categoriaNome?.trim()) {
    await memoria.salvar_habito(usuarioId, "categoria_habitual", nomes.categoriaNome.trim());
  }
  const slug = slug_estabelecimento(entrada.descricao);
  if (slug.length >= 2) {
    await memoria.salvar_habito(usuarioId, `estabelecimento:${slug}`, entrada.descricao.trim());
  }
}
