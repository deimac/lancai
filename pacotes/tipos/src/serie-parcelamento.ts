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

/** Tira o "1/3" / "01/02" que o cartão cola no fim — irmãs da mesma compra. */
export function enxugar_indice_parcela(texto: string): string {
  return texto.replace(/\s*\d{1,2}\s*\/\s*\d{1,2}\s*$/u, "").trim();
}

function normalizar_descricao_serie(texto: string): string {
  return normalizar_descricao_parcela(enxugar_indice_parcela(texto)).replace(/\d{7,}/g, (digitos) =>
    digitos.slice(0, 6),
  );
}

/** KASM/KASMOBILE, IBERIA truncada: uma descrição é prefixo da outra. */
export function descricoes_da_mesma_serie(a: string, b: string): boolean {
  const na = normalizar_descricao_serie(a);
  const nb = normalizar_descricao_serie(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.startsWith(nb) || nb.startsWith(na);
}

/** Prefere o texto mais completo (KASMOBILE, não o recorte KASM da fatura). */
export function descricao_mais_completa(textos: string[]): string {
  if (textos.length === 0) return "";
  return textos
    .map((texto) => enxugar_indice_parcela(texto))
    .reduce((melhor, atual) => (atual.length > melhor.length ? atual : melhor));
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
    normalizar_descricao_serie(movimento.descricao),
  ].join("|");
}

export function chave_serie_sem_descricao(movimento: MovimentoSerieParcela): string | null {
  if (!eh_movimento_parcelado(movimento)) return null;
  const compra = data_iso_parcela(movimento.parcelaCompraEm);
  if (!compra || !movimento.cartaoId) return null;
  return `${movimento.cartaoId}|${compra}|${movimento.parcelaTotal}`;
}

export function agrupar_series_parcelamento<T extends MovimentoSerieParcela>(movimentos: T[]): T[][] {
  const porCompra = new Map<string, T[]>();
  for (const movimento of movimentos) {
    if (movimento.status === "cancelado") continue;
    const chave = chave_serie_sem_descricao(movimento);
    if (!chave) continue;
    const grupo = porCompra.get(chave) ?? [];
    grupo.push(movimento);
    porCompra.set(chave, grupo);
  }

  const grupos: T[][] = [];
  for (const bucket of porCompra.values()) {
    const clusters: T[][] = [];
    for (const item of bucket) {
      const cluster = clusters.find((atual) => descricoes_da_mesma_serie(atual[0]!.descricao, item.descricao));
      if (cluster) cluster.push(item);
      else clusters.push([item]);
    }
    grupos.push(...clusters);
  }

  return grupos.map((grupo) =>
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
