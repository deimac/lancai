import type { Cartao, Categoria, Conta, Movimento, Parcela } from "@lancai/banco";
import type { Perfil, StatusMovimento, TipoMovimento } from "@lancai/tipos";

export interface FiltroMovimentos {
  perfil?: Perfil;
  contaId?: string;
  cartaoId?: string;
  categoriaId?: string;
  pessoaId?: string;
  periodo?: { de: string; ate: string };
  /** Quando informado, restringe a `movimento.tipo` (ex.: só receita/despesa para "evolução"). */
  tipos?: TipoMovimento[];
  /** Por padrão, exclui apenas `'cancelado'` — quase toda visão quer isso. */
  statusExcluir?: StatusMovimento[];
  /**
   * Pagamento de fatura fica `ignoradoEmRelatorio` para não inflar despesa.
   * A agenda precisa lê-lo mesmo assim para marcar a fatura como paga.
   */
  incluirIgnorados?: boolean;
}

export interface FiltroParcelas {
  cartaoId?: string;
  periodo?: { de: string; ate: string };
  /** Por padrão, exclui apenas `'cancelado'`. */
  statusExcluir?: StatusMovimento[];
}

export interface ParcelaComMovimento extends Parcela {
  movimento: Movimento;
}

/**
 * Porta de leitura/agregação usada pelo `ModuloRelatorios`. Diferente do
 * `RepositorioFinanceiro` (modulos/financeiro, focado em persistir um único
 * lançamento) e do `RepositorioContexto` (modulos/ia, focado em buscar por
 * nome), este repositório serve consultas que abrangem vários registros de
 * uma vez — sempre somando/agrupando em JS (mesmo padrão já usado em
 * `RepositorioFinanceiroDrizzle.obterTotalComprometidoCartao`), nunca com
 * `DELETE`/mutação.
 */
export interface RepositorioRelatorios {
  listarContas(usuarioId: string, perfil?: Perfil): Promise<Conta[]>;
  listarCartoes(usuarioId: string, perfil?: Perfil): Promise<Cartao[]>;
  listarCategorias(usuarioId: string): Promise<Categoria[]>;
  obterCategoria(id: string): Promise<Categoria | undefined>;
  listarMovimentos(usuarioId: string, filtro: FiltroMovimentos): Promise<Movimento[]>;
  /** Parcelas com o `movimento` (compra original) já embutido — evita N+1 ao agrupar por compra. */
  listarParcelas(usuarioId: string, filtro: FiltroParcelas): Promise<ParcelaComMovimento[]>;
}
