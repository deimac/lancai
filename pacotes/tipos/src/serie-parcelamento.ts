/**
 * Chave da série de parcelamento OF: cada parcela é um movimento próprio.
 * Agrupa por cartão + data da compra + quantidade + descrição normalizada.
 */

export type MovimentoSerieParcela = {
  id: string;
  descricao: string;
  valor: string | number;
  dataMovimento?: string;
  cartaoId?: string | null;
  parcelaNumero?: number | null;
  parcelaTotal?: number | null;
  parcelaCompraEm?: string | Date | null;
  parcelaCompraValor?: string | number | null;
  status?: string;
};

export function normalizar_descricao_parcela(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();
}

export function data_iso_parcela(valor: string | Date | null | undefined): string | null {
  if (valor == null) return null;
  const texto = typeof valor === "string" ? valor : valor.toISOString();
  const iso = texto.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

export function eh_movimento_parcelado(
  movimento: Pick<MovimentoSerieParcela, "cartaoId" | "parcelaTotal" | "parcelaCompraEm">,
): boolean {
  const total = movimento.parcelaTotal;
  return Boolean(movimento.cartaoId && total != null && total >= 2 && movimento.parcelaCompraEm);
}

export function chave_serie_parcelamento(movimento: MovimentoSerieParcela): string | null {
  if (!eh_movimento_parcelado(movimento)) return null;
  const compra = data_iso_parcela(movimento.parcelaCompraEm);
  if (!compra || !movimento.cartaoId) return null;
  return [
    movimento.cartaoId,
    compra,
    String(movimento.parcelaTotal),
    normalizar_descricao_parcela(movimento.descricao),
  ].join("|");
}

export function chave_serie_sem_descricao(movimento: MovimentoSerieParcela): string | null {
  if (!eh_movimento_parcelado(movimento)) return null;
  const compra = data_iso_parcela(movimento.parcelaCompraEm);
  if (!compra || !movimento.cartaoId) return null;
  return `${movimento.cartaoId}|${compra}|${movimento.parcelaTotal}`;
}

export function agrupar_series_parcelamento<T extends MovimentoSerieParcela>(movimentos: T[]): T[][] {
  const porChave = new Map<string, T[]>();
  for (const movimento of movimentos) {
    if (movimento.status === "cancelado") continue;
    const chave = chave_serie_parcelamento(movimento);
    if (!chave) continue;
    const grupo = porChave.get(chave) ?? [];
    grupo.push(movimento);
    porChave.set(chave, grupo);
  }
  return [...porChave.values()].map((grupo) =>
    [...grupo].sort((a, b) => {
      const na = a.parcelaNumero ?? 0;
      const nb = b.parcelaNumero ?? 0;
      if (na !== nb) return na - nb;
      return String(a.dataMovimento ?? "").localeCompare(String(b.dataMovimento ?? ""));
    }),
  );
}

/** Irmãs da âncora: mesmo cartão + compra + total; prefere a mesma descrição. */
export function irmas_da_serie<T extends MovimentoSerieParcela>(
  ancora: MovimentoSerieParcela,
  candidatos: T[],
): T[] {
  const chaveAncora = chave_serie_sem_descricao(ancora);
  if (!chaveAncora) return [];
  const mesmaCompra = candidatos.filter(
    (item) => item.status !== "cancelado" && chave_serie_sem_descricao(item) === chaveAncora,
  );
  const descricao = normalizar_descricao_parcela(ancora.descricao);
  const mesmasDescricao = mesmaCompra.filter(
    (item) => normalizar_descricao_parcela(item.descricao) === descricao,
  );
  const irmas = mesmasDescricao.length > 0 ? mesmasDescricao : mesmaCompra;
  return irmas.sort((a, b) => {
    const na = a.parcelaNumero ?? 0;
    const nb = b.parcelaNumero ?? 0;
    if (na !== nb) return na - nb;
    return String(a.dataMovimento ?? "").localeCompare(String(b.dataMovimento ?? ""));
  });
}
