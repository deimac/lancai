import { createHash } from "node:crypto";
import { somar_meses } from "./pluggy/traducao";

/** Prefixo de `id_externo` das parcelas que o LançAI completa quando o OF omite. */
export const PREFIXO_PARCELA_PROJETADA = "lancai:proj:";

export interface ParcelaSerieEntrada {
  parcelaNumero: number;
  parcelaTotal: number;
  parcelaCompraEm: string;
  parcelaCompraValor: string | null;
  valor: string | number;
  dataMovimento: string;
  descricao: string;
  idExterno: string | null;
  status: string;
  statusFonte: string | null;
}

export interface SerieParcelamento {
  compraEm: string;
  total: number;
  valorCompra: string;
  descricao: string;
  valorParcela: number;
  datasPorNumero: Map<number, string>;
  numerosPresentes: Set<number>;
}

export interface ParcelaProjetada {
  numero: number;
  total: number;
  compraEm: string;
  valorCompra: number;
  valor: number;
  ocorridoEm: string;
  descricaoFonte: string;
  idExterno: string;
}

function normalizar_decimal(valor: string | number): string {
  const n = typeof valor === "number" ? valor : Number.parseFloat(valor);
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

function moda_decimal(valores: Array<string | number>): string {
  const contagem = new Map<string, number>();
  for (const valor of valores) {
    const chave = normalizar_decimal(valor);
    contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
  }
  let moda = "0.00";
  let melhor = 0;
  for (const [valor, n] of contagem) {
    if (n > melhor) {
      melhor = n;
      moda = valor;
    }
  }
  return moda;
}

export function eh_id_parcela_projetada(idExterno: string | null | undefined): boolean {
  return Boolean(idExterno?.startsWith(PREFIXO_PARCELA_PROJETADA));
}

export function hash_serie_parcelamento(entrada: {
  workspaceId: string;
  cartaoId: string;
  compraEm: string;
  total: number;
  valorCompra: string;
}): string {
  const base = [
    entrada.workspaceId,
    entrada.cartaoId,
    entrada.compraEm,
    String(entrada.total),
    entrada.valorCompra,
  ].join("|");
  return createHash("sha256").update(base).digest("hex").slice(0, 16);
}

export function id_externo_parcela_projetada(entrada: {
  workspaceId: string;
  cartaoId: string;
  compraEm: string;
  total: number;
  valorCompra: string;
  numero: number;
}): string {
  const hash = hash_serie_parcelamento(entrada);
  return `${PREFIXO_PARCELA_PROJETADA}${hash}:${entrada.numero}`;
}

/**
 * Valor-âncora da compra. Prefere o total da instituição; senão estima
 * moda(parcela) × total. Diferenças de centavos entre parcelas não racham a série.
 */
export function valor_compra_da_serie(
  parcelas: Array<{ parcelaCompraValor: string | null; valor: string | number }>,
  total: number,
): string {
  const totais = parcelas
    .map((p) => p.parcelaCompraValor)
    .filter((v): v is string => v != null && v !== "")
    .map((v) => Number.parseFloat(v))
    .filter((n) => Number.isFinite(n));

  if (totais.length > 0) {
    // Moda arredondada ao real — evita 822.12 vs 822.14 racharem a série.
    const arredondados = totais.map((n) => Math.round(n).toFixed(2));
    return moda_decimal(arredondados);
  }

  return normalizar_decimal(Number.parseFloat(moda_decimal(parcelas.map((p) => p.valor))) * total);
}

/**
 * No mesmo dia + mesmo total de parcelas, só separa compras distintas quando a
 * instituição informou totais claramente diferentes (> R$ 1). Caso contrário
 * é a mesma compra com descrição variante (KASM/KASMOBILE, IBERIA*…0563).
 */
function separar_compras_distintas(grupo: ParcelaSerieEntrada[]): ParcelaSerieEntrada[][] {
  const comTotal = new Map<string, ParcelaSerieEntrada[]>();
  for (const p of grupo) {
    if (p.parcelaCompraValor == null || p.parcelaCompraValor === "") continue;
    const chave = Math.round(Number.parseFloat(p.parcelaCompraValor)).toFixed(2);
    const lista = comTotal.get(chave) ?? [];
    lista.push(p);
    comTotal.set(chave, lista);
  }

  if (comTotal.size >= 2) {
    const chaves = [...comTotal.keys()].map(Number).sort((a, b) => a - b);
    const distintas = chaves.some((v, i) => i > 0 && v - chaves[i - 1]! > 1);
    if (distintas) {
      // Parcelas sem total caem no grupo cujo total mais se aproxima de valor×N.
      const buckets = [...comTotal.entries()].map(([k, itens]) => ({
        chave: Number(k),
        itens: [...itens],
      }));
      for (const p of grupo) {
        if (p.parcelaCompraValor != null && p.parcelaCompraValor !== "") continue;
        const estimativa = Number.parseFloat(normalizar_decimal(p.valor)) * p.parcelaTotal;
        let melhor = buckets[0]!;
        let menor = Math.abs(estimativa - melhor.chave);
        for (const b of buckets) {
          const d = Math.abs(estimativa - b.chave);
          if (d < menor) {
            menor = d;
            melhor = b;
          }
        }
        melhor.itens.push(p);
      }
      return buckets.map((b) => b.itens);
    }
  }

  return [grupo];
}

/** Agrupa Fatos ativos de um cartão em séries de parcelamento. */
export function agrupar_series_parcelamento(parcelas: ParcelaSerieEntrada[]): SerieParcelamento[] {
  const ativas = parcelas.filter(
    (p) =>
      p.status !== "cancelado" &&
      p.statusFonte !== "removido" &&
      p.parcelaTotal >= 2 &&
      p.parcelaNumero >= 1 &&
      /^\d{4}-\d{2}-\d{2}$/.test(p.parcelaCompraEm),
  );

  const porCompraTotal = new Map<string, ParcelaSerieEntrada[]>();
  for (const p of ativas) {
    const chave = `${p.parcelaCompraEm}|${p.parcelaTotal}`;
    const grupo = porCompraTotal.get(chave) ?? [];
    grupo.push(p);
    porCompraTotal.set(chave, grupo);
  }

  const series: SerieParcelamento[] = [];
  for (const grupo of porCompraTotal.values()) {
    for (const sub of separar_compras_distintas(grupo)) {
      const total = sub[0]!.parcelaTotal;
      const compraEm = sub[0]!.parcelaCompraEm;
      const valorCompra = valor_compra_da_serie(sub, total);
      // A 1ª parcela costuma absorver o arredondamento (+R$ 0,02); preferimos as demais.
      const referenciaValor = sub.filter((p) => p.parcelaNumero > 1);
      const valorParcela = Number.parseFloat(
        moda_decimal((referenciaValor.length > 0 ? referenciaValor : sub).map((p) => p.valor)),
      );
      const datasPorNumero = new Map<number, string>();
      const numerosPresentes = new Set<number>();
      let descricao = sub[0]!.descricao;
      for (const p of sub) {
        numerosPresentes.add(p.parcelaNumero);
        // Prefere data de Fato real (não projetado) quando há colisão de número.
        if (!datasPorNumero.has(p.parcelaNumero) || !eh_id_parcela_projetada(p.idExterno)) {
          datasPorNumero.set(p.parcelaNumero, p.dataMovimento.slice(0, 10));
        }
        if (!eh_id_parcela_projetada(p.idExterno)) descricao = p.descricao;
      }
      series.push({
        compraEm,
        total,
        valorCompra,
        descricao,
        valorParcela,
        datasPorNumero,
        numerosPresentes,
      });
    }
  }

  return series;
}

/**
 * Extrapolação mensal a partir da parcela conhecida mais próxima.
 * Ex.: temos 1→2026-06 e 2→2026-07; falta 4 → 2026-09-01.
 */
export function projetar_data_parcela(
  datasPorNumero: Map<number, string>,
  numero: number,
  compraEm: string,
): string {
  let ancoraNumero: number | null = null;
  let menorDist = Number.POSITIVE_INFINITY;
  for (const n of datasPorNumero.keys()) {
    const dist = Math.abs(n - numero);
    if (dist < menorDist) {
      menorDist = dist;
      ancoraNumero = n;
    }
  }

  if (ancoraNumero != null) {
    const ancoraData = datasPorNumero.get(ancoraNumero)!;
    const mesAncora = `${ancoraData.slice(0, 7)}-01`;
    return somar_meses(mesAncora, numero - ancoraNumero);
  }

  return somar_meses(`${compraEm.slice(0, 7)}-01`, numero);
}

export function planejar_parcelas_faltantes(entrada: {
  workspaceId: string;
  cartaoId: string;
  series: SerieParcelamento[];
}): ParcelaProjetada[] {
  const projetadas: ParcelaProjetada[] = [];

  for (const serie of entrada.series) {
    for (let n = 1; n <= serie.total; n += 1) {
      if (serie.numerosPresentes.has(n)) continue;
      projetadas.push({
        numero: n,
        total: serie.total,
        compraEm: serie.compraEm,
        valorCompra: Number.parseFloat(serie.valorCompra),
        valor: serie.valorParcela,
        ocorridoEm: projetar_data_parcela(serie.datasPorNumero, n, serie.compraEm),
        descricaoFonte: serie.descricao,
        idExterno: id_externo_parcela_projetada({
          workspaceId: entrada.workspaceId,
          cartaoId: entrada.cartaoId,
          compraEm: serie.compraEm,
          total: serie.total,
          valorCompra: serie.valorCompra,
          numero: n,
        }),
      });
    }
  }

  return projetadas;
}
