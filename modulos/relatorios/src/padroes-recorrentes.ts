import { eh_movimento_parcelado, hojeISO, normalizar_descricao_parcela } from "@lancai/tipos";

export type MovimentoPadraoRecorrente = {
  descricao: string;
  valor: string | number;
  dataMovimento: string;
  tipo: string;
  status?: string;
  cartaoId: string | null;
  contaId?: string | null;
  parcelaTotal: number | null;
  parcelaCompraEm: string | Date | null;
  categoriaId: string;
};

export type PadraoRecorrente = {
  descricao: string;
  valor: number;
  mesesObservados: string[];
  categoriaId: string;
  contaId: string | null;
  cartaoId: string | null;
  diaDoMes: number | null;
};

function chave_padrao(descricao: string, valor: number): string {
  return `${normalizar_descricao_parcela(descricao)}|${Math.round(valor)}`;
}

function indice_mes(yyyyMm: string): number {
  const [ano, mes] = yyyyMm.split("-").map(Number);
  return (ano ?? 0) * 12 + ((mes ?? 1) - 1);
}

function mes_limite_vigente(dataAtual: string): string {
  const [ano, mes] = dataAtual.slice(0, 7).split("-").map(Number);
  const cursor = new Date(Date.UTC(ano ?? 0, (mes ?? 1) - 2, 1));
  return `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`;
}

function dia_do_iso(data: string): number {
  const dia = Number(String(data).slice(8, 10));
  return Number.isFinite(dia) ? dia : 0;
}

/** Menor arco no calendário de 31 dias que cobre os dias observados. */
function amplitude_dias(dias: number[]): number {
  const unicos = [...new Set(dias.filter((dia) => dia >= 1 && dia <= 31))].sort((a, b) => a - b);
  if (unicos.length <= 1) return 0;
  const ciclo = 31;
  let maiorBuraco = 0;
  for (let i = 1; i < unicos.length; i++) {
    maiorBuraco = Math.max(maiorBuraco, unicos[i]! - unicos[i - 1]!);
  }
  maiorBuraco = Math.max(maiorBuraco, unicos[0]! + ciclo - unicos[unicos.length - 1]!);
  return ciclo - maiorBuraco;
}

function mediana_inteiro(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  return ordenados[Math.floor((ordenados.length - 1) / 2)] ?? null;
}

/**
 * Assinatura ainda vigente: mesma descrição + valor estável, ~1 vez por mês,
 * no mesmo dia, com cobrança neste mês ou no anterior. Fora: Uber/iFood
 * coincidentes e assinaturas canceladas.
 */
export function detectar_padroes_recorrentes(
  movimentos: MovimentoPadraoRecorrente[],
  dataAtual: string = hojeISO(),
): PadraoRecorrente[] {
  const grupos = new Map<
    string,
    {
      descricao: string;
      valores: number[];
      meses: Set<string>;
      dias: number[];
      porMes: Map<string, number>;
      categoriaId: string;
      contaId: string | null;
      cartaoId: string | null;
    }
  >();

  for (const movimento of movimentos) {
    if (movimento.tipo !== "despesa") continue;
    if (movimento.status === "cancelado") continue;
    if (eh_movimento_parcelado(movimento)) continue;
    const valor = Number(movimento.valor);
    if (!Number.isFinite(valor) || valor <= 0) continue;
    const mes = String(movimento.dataMovimento).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(mes)) continue;
    const chave = chave_padrao(movimento.descricao, valor);
    const atual = grupos.get(chave) ?? {
      descricao: movimento.descricao,
      valores: [],
      meses: new Set<string>(),
      dias: [],
      porMes: new Map<string, number>(),
      categoriaId: movimento.categoriaId,
      contaId: movimento.contaId ?? null,
      cartaoId: movimento.cartaoId,
    };
    atual.valores.push(valor);
    atual.meses.add(mes);
    atual.dias.push(dia_do_iso(String(movimento.dataMovimento)));
    atual.porMes.set(mes, (atual.porMes.get(mes) ?? 0) + 1);
    grupos.set(chave, atual);
  }

  const vigenteDesde = mes_limite_vigente(dataAtual);
  const padroes: PadraoRecorrente[] = [];
  for (const grupo of grupos.values()) {
    const meses = [...grupo.meses].sort();
    if (meses.length < 2) continue;
    const ultimo = meses[meses.length - 1]!;
    const penultimo = meses[meses.length - 2]!;
    if (ultimo < vigenteDesde) continue;
    if (indice_mes(ultimo) - indice_mes(penultimo) !== 1) continue;
    if ([...grupo.porMes.values()].some((n) => n > 2)) continue;
    if (grupo.valores.length / meses.length > 1.5) continue;
    if (amplitude_dias(grupo.dias) > 7) continue;
    const soma = grupo.valores.reduce((acc, n) => acc + n, 0);
    padroes.push({
      descricao: grupo.descricao,
      valor: Math.round((soma / grupo.valores.length) * 100) / 100,
      mesesObservados: meses,
      categoriaId: grupo.categoriaId,
      contaId: grupo.contaId,
      cartaoId: grupo.cartaoId,
      diaDoMes: mediana_inteiro(grupo.dias.filter((dia) => dia >= 1)),
    });
  }
  return padroes.sort((a, b) => b.valor - a.valor);
}
