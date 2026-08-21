import { eh_movimento_parcelado, normalizar_descricao_parcela } from "@lancai/tipos";

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
};

function chave_padrao(descricao: string, valor: number): string {
  return `${normalizar_descricao_parcela(descricao)}|${Math.round(valor)}`;
}

/**
 * Assinatura no extrato: mesma descrição enxuta + valor ≈ (± R$ 0,50 via arredondamento)
 * em pelo menos dois meses, fora de parcelamento.
 */
export function detectar_padroes_recorrentes(
  movimentos: MovimentoPadraoRecorrente[],
): PadraoRecorrente[] {
  const grupos = new Map<
    string,
    {
      descricao: string;
      valores: number[];
      meses: Set<string>;
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
      categoriaId: movimento.categoriaId,
      contaId: movimento.contaId ?? null,
      cartaoId: movimento.cartaoId,
    };
    atual.valores.push(valor);
    atual.meses.add(mes);
    grupos.set(chave, atual);
  }

  const padroes: PadraoRecorrente[] = [];
  for (const grupo of grupos.values()) {
    if (grupo.meses.size < 2) continue;
    const soma = grupo.valores.reduce((acc, n) => acc + n, 0);
    padroes.push({
      descricao: grupo.descricao,
      valor: Math.round((soma / grupo.valores.length) * 100) / 100,
      mesesObservados: [...grupo.meses].sort(),
      categoriaId: grupo.categoriaId,
      contaId: grupo.contaId,
      cartaoId: grupo.cartaoId,
    });
  }
  return padroes.sort((a, b) => b.valor - a.valor);
}
