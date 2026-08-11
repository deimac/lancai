import type { Cartao, Categoria, Conta, Movimento, Parcela } from "@lancai/banco";
import type { Perfil } from "@lancai/tipos";
import type {
  FiltroMovimentos,
  FiltroParcelas,
  ParcelaComMovimento,
  RepositorioRelatorios,
} from "./repositorio-relatorios";

/** Implementação em memória do RepositorioRelatorios, usada nos testes unitários do ModuloRelatorios. */
export class RepositorioRelatoriosMemoria implements RepositorioRelatorios {
  readonly contas = new Map<string, Conta>();
  readonly cartoes = new Map<string, Cartao>();
  readonly categorias = new Map<string, Categoria>();
  readonly movimentos = new Map<string, Movimento>();
  readonly parcelas = new Map<string, Parcela>();

  async listarContas(usuarioId: string, perfil?: Perfil) {
    return [...this.contas.values()].filter(
      (conta) => conta.usuarioId === usuarioId && conta.ativo && (!perfil || conta.perfil === perfil),
    );
  }

  async listarCartoes(usuarioId: string, perfil?: Perfil) {
    return [...this.cartoes.values()].filter(
      (cartao) => cartao.usuarioId === usuarioId && cartao.ativo && (!perfil || cartao.perfil === perfil),
    );
  }

  async listarCategorias(usuarioId: string) {
    return [...this.categorias.values()].filter((categoria) => categoria.usuarioId === usuarioId);
  }

  async obterCategoria(id: string) {
    return this.categorias.get(id);
  }

  async listarMovimentos(usuarioId: string, filtro: FiltroMovimentos) {
    const statusExcluir = filtro.statusExcluir ?? ["cancelado"];
    return [...this.movimentos.values()].filter((movimento) => {
      if (movimento.usuarioId !== usuarioId) return false;
      if (movimento.ignoradoEmRelatorio) return false;
      if (statusExcluir.includes(movimento.status)) return false;
      if (filtro.perfil && movimento.perfil !== filtro.perfil) return false;
      if (filtro.contaId && movimento.contaId !== filtro.contaId) return false;
      if (filtro.cartaoId && movimento.cartaoId !== filtro.cartaoId) return false;
      if (filtro.categoriaId && movimento.categoriaId !== filtro.categoriaId) return false;
      if (filtro.pessoaId && movimento.pessoaId !== filtro.pessoaId) return false;
      if (filtro.tipos?.length && !filtro.tipos.includes(movimento.tipo)) return false;
      if (filtro.periodo && (movimento.dataMovimento < filtro.periodo.de || movimento.dataMovimento > filtro.periodo.ate)) {
        return false;
      }
      return true;
    });
  }

  async listarParcelas(usuarioId: string, filtro: FiltroParcelas): Promise<ParcelaComMovimento[]> {
    const statusExcluir = filtro.statusExcluir ?? ["cancelado"];
    const resultado: ParcelaComMovimento[] = [];

    for (const parcela of this.parcelas.values()) {
      const movimento = this.movimentos.get(parcela.movimentoId);
      if (!movimento || movimento.usuarioId !== usuarioId) continue;
      if (statusExcluir.includes(parcela.status)) continue;
      if (filtro.cartaoId && movimento.cartaoId !== filtro.cartaoId) continue;
      if (filtro.periodo && (parcela.dataMovimento < filtro.periodo.de || parcela.dataMovimento > filtro.periodo.ate)) {
        continue;
      }
      resultado.push({ ...parcela, movimento });
    }

    return resultado;
  }
}
