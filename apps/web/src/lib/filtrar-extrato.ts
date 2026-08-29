import type { MovimentoResumo } from "./api";
import { eh_nao_classificado, precisa_revisao } from "./fila-revisao";
import { mapa_fechamento_cartoes, mapa_vencimento_cartoes, movimento_no_resultado_do_mes } from "@lancai/tipos";

export type FilaExtrato = "todas" | "banco" | "manual" | "revisar";

export type ClassificacaoExtrato =
  | "todas"
  | "usuario"
  | "regra"
  | "ia"
  | "sem_classificar";

export type OrigemExtrato =
  | { tipo: "todas" }
  | { tipo: "contas" }
  | { tipo: "cartoes" }
  | { tipo: "conta"; id: string }
  | { tipo: "cartao"; id: string };

export type TipoGastoExtrato = "todas" | "pessoal" | "empresa";

export type PapelExtrato = "todas" | "gastos" | "pagamentos_fatura";

export const TAMANHOS_PAGINA = [10, 25, 50, 100] as const;
export const TAMANHO_PAGINA_PADRAO = 10;

export type FiltrosExtrato = {
  mes: string;
  fila: FilaExtrato;
  busca: string;
  categoriaId: string | null;
  classificacao: ClassificacaoExtrato;
  origem: OrigemExtrato;
  tipoGasto: TipoGastoExtrato;
  papel: PapelExtrato;
};

type OrigemNomeada = { id: string; nome: string };

export function fila_da_query(valor: string | null): FilaExtrato {
  if (valor === "banco" || valor === "manual" || valor === "revisar" || valor === "todas") {
    return valor;
  }
  return "todas";
}

export function classificacao_da_query(valor: string | null): ClassificacaoExtrato {
  if (
    valor === "usuario" ||
    valor === "regra" ||
    valor === "ia" ||
    valor === "sem_classificar"
  ) {
    return valor;
  }
  return "todas";
}

export function origem_da_query(valor: string | null): OrigemExtrato {
  if (!valor) return { tipo: "todas" };
  if (valor === "contas" || valor === "cartoes") return { tipo: valor };
  const separador = valor.indexOf(":");
  if (separador <= 0) return { tipo: "todas" };
  const tipo = valor.slice(0, separador);
  const id = valor.slice(separador + 1);
  if ((tipo === "conta" || tipo === "cartao") && id) return { tipo, id };
  return { tipo: "todas" };
}

export function origem_para_query(origem: OrigemExtrato): string | null {
  if (origem.tipo === "todas") return null;
  if (origem.tipo === "contas" || origem.tipo === "cartoes") return origem.tipo;
  return `${origem.tipo}:${origem.id}`;
}

export function tipo_gasto_da_query(valor: string | null): TipoGastoExtrato {
  if (valor === "pessoal" || valor === "empresa") return valor;
  return "todas";
}

export function tipo_gasto_para_query(tipo: TipoGastoExtrato): string | null {
  return tipo === "todas" ? null : tipo;
}

/** Cockpit: sem param = todos, como o extrato. `todos` na URL também é todos. */
export function tipo_gasto_dashboard_da_query(valor: string | null): TipoGastoExtrato {
  return tipo_gasto_da_query(valor);
}

export function tipo_gasto_dashboard_para_query(tipo: TipoGastoExtrato): string | null {
  return tipo_gasto_para_query(tipo);
}

/** Menu do Cockpit: tira `tipoGasto` da URL e mantém o mês. */
export function search_sem_tipo_gasto(search: string): string {
  const bruto = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(bruto);
  params.delete("tipoGasto");
  const texto = params.toString();
  return texto ? `?${texto}` : "";
}

export function perfil_de_tipo_gasto(tipo: TipoGastoExtrato): "pf" | "pj" | undefined {
  if (tipo === "pessoal") return "pf";
  if (tipo === "empresa") return "pj";
  return undefined;
}

export function papel_da_query(valor: string | null): PapelExtrato {
  if (valor === "gastos" || valor === "pagamentos_fatura") return valor;
  return "todas";
}

export function papel_para_query(papel: PapelExtrato): string | null {
  return papel === "todas" ? null : papel;
}

export function tamanho_pagina_da_query(valor: string | null): number {
  const n = Number(valor);
  if ((TAMANHOS_PAGINA as readonly number[]).includes(n)) return n;
  return TAMANHO_PAGINA_PADRAO;
}

export function nome_origem_movimento(
  movimento: Pick<MovimentoResumo, "contaId" | "cartaoId">,
  contas: OrigemNomeada[],
  cartoes: OrigemNomeada[],
): string {
  if (movimento.contaId) {
    return contas.find((c) => c.id === movimento.contaId)?.nome ?? "Conta";
  }
  if (movimento.cartaoId) {
    return cartoes.find((c) => c.id === movimento.cartaoId)?.nome ?? "Cartão";
  }
  return "Sem origem";
}

export function normalizar_busca(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

export function filtrar_extrato(
  movimentos: MovimentoResumo[],
  contas: OrigemNomeada[],
  cartoes: OrigemNomeada[],
  filtros: FiltrosExtrato,
): MovimentoResumo[] {
  const termo = normalizar_busca(filtros.busca);
  return movimentos.filter((movimento) => {
    if (movimento.status === "cancelado") return false;
    if (!movimento.dataMovimento.startsWith(`${filtros.mes}-`)) return false;
    if (filtros.fila === "banco" && movimento.fonte !== "open_finance") return false;
    if (filtros.fila === "manual" && movimento.fonte === "open_finance") return false;
    if (filtros.fila === "revisar" && !precisa_revisao(movimento)) return false;

    if (filtros.origem.tipo === "contas" && !movimento.contaId) return false;
    if (filtros.origem.tipo === "cartoes" && !movimento.cartaoId) return false;
    if (filtros.origem.tipo === "conta" && movimento.contaId !== filtros.origem.id) return false;
    if (filtros.origem.tipo === "cartao" && movimento.cartaoId !== filtros.origem.id) {
      return false;
    }

    if (filtros.categoriaId && movimento.categoriaId !== filtros.categoriaId) return false;

    if (filtros.classificacao === "sem_classificar") {
      if (!eh_nao_classificado(movimento.categoriaNome)) return false;
    } else if (
      filtros.classificacao !== "todas" &&
      movimento.classificadoPor !== filtros.classificacao
    ) {
      return false;
    }

    if (filtros.tipoGasto === "pessoal" && movimento.tipoGasto !== "pf") return false;
    if (filtros.tipoGasto === "empresa" && movimento.tipoGasto !== "pj") return false;

    if (filtros.papel === "gastos" && movimento.papel === "pagamento_fatura") return false;
    if (filtros.papel === "pagamentos_fatura" && movimento.papel !== "pagamento_fatura") {
      return false;
    }

    if (termo) {
      const origem = nome_origem_movimento(movimento, contas, cartoes);
      const haystack = normalizar_busca(
        `${movimento.descricao} ${movimento.descricaoFonte} ${origem}`,
      );
      if (!haystack.includes(termo)) return false;
    }

    return true;
  });
}

function eh_entrada_extrato(tipo: string): boolean {
  return tipo === "receita" || tipo === "reembolso" || tipo === "estorno" || tipo === "aporte";
}

export type ResumoExtrato = {
  entradas: number;
  saidas: number;
  resultado: number;
  revisarQuantidade: number;
  revisarTotal: number;
  proximaFatura: number;
};

export type CartaoCicloExtrato = { id: string; fechamento?: number | null; vencimento?: number | null };

/** Totais do recorte já filtrado (exclui cancelados e pagamento de fatura). */
export function resumir_extrato(
  movimentos: MovimentoResumo[],
  opcoes?: { mes?: string; cartoes?: CartaoCicloExtrato[] },
): ResumoExtrato {
  const fechamentoPorCartao = mapa_fechamento_cartoes(opcoes?.cartoes ?? []);
  const vencimentoPorCartao = mapa_vencimento_cartoes(opcoes?.cartoes ?? []);
  let entradas = 0;
  let saidas = 0;
  let revisarQuantidade = 0;
  let revisarTotal = 0;
  let proximaFatura = 0;
  for (const movimento of movimentos) {
    if (movimento.status === "cancelado") continue;
    const valor = Number(movimento.valor);
    const seguro = Number.isFinite(valor) ? valor : 0;
    if (movimento.papel !== "pagamento_fatura") {
      if (eh_entrada_extrato(movimento.tipo)) {
        entradas += seguro;
      } else {
        const noResultado =
          !opcoes?.mes ||
          movimento_no_resultado_do_mes(movimento, opcoes.mes, fechamentoPorCartao, vencimentoPorCartao);
        if (noResultado) saidas += seguro;
        else proximaFatura += seguro;
      }
    }
    if (precisa_revisao(movimento)) {
      revisarQuantidade += 1;
      revisarTotal += seguro;
    }
  }
  return {
    entradas,
    saidas,
    resultado: entradas - saidas,
    revisarQuantidade,
    revisarTotal,
    proximaFatura,
  };
}

export function quantidade_filtros_drawer(
  filtros: Pick<FiltrosExtrato, "categoriaId" | "classificacao" | "papel" | "fila">,
): number {
  let n = 0;
  if (filtros.categoriaId) n += 1;
  if (filtros.classificacao !== "todas") n += 1;
  if (filtros.papel !== "todas") n += 1;
  if (filtros.fila !== "todas") n += 1;
  return n;
}

export type PaginaExtrato<T> = {
  itens: T[];
  pagina: number;
  paginas: number;
  total: number;
  de: number;
  ate: number;
  porPagina: number;
};

export function paginar<T>(itens: T[], pagina: number, porPagina: number): PaginaExtrato<T> {
  const total = itens.length;
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const paginaAtual = Math.min(Math.max(1, pagina), paginas);
  const inicio = total === 0 ? 0 : (paginaAtual - 1) * porPagina;
  const fatia = itens.slice(inicio, inicio + porPagina);
  return {
    itens: fatia,
    pagina: paginaAtual,
    paginas,
    total,
    de: total === 0 ? 0 : inicio + 1,
    ate: inicio + fatia.length,
    porPagina,
  };
}

/** Ordena categorias pelo uso nos movimentos já carregados (workspace ativo). */
export function ordenar_categorias_por_uso<T extends { id: string; nome: string }>(
  categorias: T[],
  movimentos: Array<Pick<MovimentoResumo, "categoriaId" | "status">>,
): T[] {
  const uso = new Map<string, number>();
  for (const movimento of movimentos) {
    if (movimento.status === "cancelado") continue;
    uso.set(movimento.categoriaId, (uso.get(movimento.categoriaId) ?? 0) + 1);
  }
  return [...categorias].sort((a, b) => {
    const da = uso.get(a.id) ?? 0;
    const db = uso.get(b.id) ?? 0;
    if (db !== da) return db - da;
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
}

/** Categorias que de fato aparecem no recorte — para o filtro do extrato, não o catálogo inteiro. */
export function categorias_com_lancamentos<T extends { id: string; nome: string }>(
  categorias: T[],
  movimentos: Array<Pick<MovimentoResumo, "categoriaId" | "status">>,
): T[] {
  const usadas = new Set<string>();
  for (const movimento of movimentos) {
    if (movimento.status === "cancelado") continue;
    if (movimento.categoriaId) usadas.add(movimento.categoriaId);
  }
  return ordenar_categorias_por_uso(
    categorias.filter((categoria) => usadas.has(categoria.id)),
    movimentos,
  );
}
