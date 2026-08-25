import { resolver_periodo_spec } from "@lancai/ia";
import type {
  FiltrosVisaoResolvidos,
  QueryState,
  TipoVisao,
} from "@lancai/tipos";
import { queryStateToSpec } from "@lancai/tipos";

export type CompileQueryInput = {
  usuarioId: string;
  dataAtual: string;
};

export type OrdenacaoHistorico = { by: "valor" | "data" | "descricao"; dir: "asc" | "desc" };

export type OpcoesConsultaCompilada = {
  deslocamento: number;
  ordenacao?: OrdenacaoHistorico;
  limite?: number;
};

export type ConsultaCompilada = {
  visao: TipoVisao;
  filtros: FiltrosVisaoResolvidos;
  opcoes: OpcoesConsultaCompilada;
};

const TOP_PADRAO: OrdenacaoHistorico = { by: "valor", dir: "desc" };

export function opcoesDeQuery(query: QueryState): OpcoesConsultaCompilada {
  const opcoes: OpcoesConsultaCompilada = { deslocamento: query.offset ?? 0 };
  if (query.grain === "summary") return opcoes;
  if (query.grain === "top") {
    opcoes.ordenacao = query.sort ?? TOP_PADRAO;
    opcoes.limite = query.limit ?? 1;
    return opcoes;
  }
  if (query.grain === "list") {
    if (query.sort) opcoes.ordenacao = query.sort;
    if (query.limit != null) opcoes.limite = query.limit;
  }
  return opcoes;
}

export function visaoDeQueryState(query: QueryState): TipoVisao {
  if (query.cruzado || query.direcao) return "fluxo";
  if (query.entityDomain === "accounts") return "saldos";
  if (query.entityDomain === "cards" && query.grain === "summary") return "cartoes";
  if (query.grain === "category") return "categoria";
  if (query.grain === "month") return "evolucao";
  return "historico";
}

/**
 * QueryState → entrada do Report Engine. Sem LLM. Não cria segundo QueryState.
 */
export function compileQuery(query: QueryState, ctx: CompileQueryInput): ConsultaCompilada {
  const visao = visaoDeQueryState(query);
  const periodo = query.period ? resolver_periodo_spec(query.period, ctx.dataAtual) : undefined;
  const filtros: FiltrosVisaoResolvidos = {
    usuarioId: ctx.usuarioId,
    perfil: query.tipoGasto,
    origemPerfil: query.origemPerfil,
    canal: query.canal,
    contaId: query.contaId,
    cartaoId: query.cartaoId,
    categoriaId: query.categoriaId,
    pessoaId: query.pessoaId,
    descricao: query.merchant ?? query.descricao,
    periodo,
    tipos: query.tipos,
    direcao: query.direcao,
  };

  return {
    visao,
    filtros,
    opcoes: opcoesDeQuery(query),
  };
}

export function specCompiladoDe(query: QueryState): ReturnType<typeof queryStateToSpec> {
  return queryStateToSpec(query, visaoDeQueryState(query));
}
