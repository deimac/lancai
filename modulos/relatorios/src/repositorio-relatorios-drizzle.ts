import { and, eq, gte, inArray, lte, notInArray } from "drizzle-orm";
import {
  cartao as cartaoTabela,
  categoria as categoriaTabela,
  conta as contaTabela,
  movimento as movimentoTabela,
  obter_banco,
  parcela as parcelaTabela,
  resolver_escopo_leitura,
} from "@lancai/banco";
import type { Perfil } from "@lancai/tipos";
import type {
  FiltroMovimentos,
  FiltroParcelas,
  ParcelaComMovimento,
  RepositorioRelatorios,
} from "./repositorio-relatorios";

/** Implementação real do RepositorioRelatorios, sobre Supabase Postgres via Drizzle. */
export class RepositorioRelatoriosDrizzle implements RepositorioRelatorios {
  private get banco() {
    return obter_banco();
  }

  async listarContas(usuarioId: string, perfil?: Perfil) {
    // Relatório/dashboard seguem o workspace ativo (menu Contas usa GET ?todos=1).
    const escopo = await resolver_escopo_leitura(this.banco, usuarioId);
    if (escopo.workspaceIds.length === 0) return [];
    const condicoes = [
      eq(contaTabela.usuarioId, usuarioId),
      inArray(contaTabela.workspaceId, escopo.workspaceIds),
      eq(contaTabela.ativo, true),
    ];
    if (perfil) condicoes.push(eq(contaTabela.perfil, perfil));
    return this.banco
      .select()
      .from(contaTabela)
      .where(and(...condicoes));
  }

  async listarCartoes(usuarioId: string, perfil?: Perfil) {
    // Relatório/dashboard seguem o workspace ativo (menu Contas usa GET ?todos=1).
    const escopo = await resolver_escopo_leitura(this.banco, usuarioId);
    if (escopo.workspaceIds.length === 0) return [];
    const condicoes = [
      eq(cartaoTabela.usuarioId, usuarioId),
      inArray(cartaoTabela.workspaceId, escopo.workspaceIds),
      eq(cartaoTabela.ativo, true),
    ];
    if (perfil) condicoes.push(eq(cartaoTabela.perfil, perfil));
    return this.banco
      .select()
      .from(cartaoTabela)
      .where(and(...condicoes));
  }

  async listarCategorias(usuarioId: string) {
    return this.banco
      .select()
      .from(categoriaTabela)
      .where(eq(categoriaTabela.usuarioId, usuarioId));
  }

  async obterCategoria(id: string) {
    const [linha] = await this.banco.select().from(categoriaTabela).where(eq(categoriaTabela.id, id)).limit(1);
    return linha;
  }

  async listarMovimentos(usuarioId: string, filtro: FiltroMovimentos) {
    const escopo = await resolver_escopo_leitura(this.banco, usuarioId);
    if (escopo.workspaceIds.length === 0) return [];
    const condicoes = [
      eq(movimentoTabela.usuarioId, usuarioId),
      inArray(movimentoTabela.workspaceId, escopo.workspaceIds),
      eq(movimentoTabela.ignoradoEmRelatorio, false),
    ];
    condicoes.push(notInArray(movimentoTabela.status, filtro.statusExcluir ?? ["cancelado"]));
    if (filtro.perfil) condicoes.push(eq(movimentoTabela.tipoGasto, filtro.perfil));
    if (filtro.contaId) condicoes.push(eq(movimentoTabela.contaId, filtro.contaId));
    if (filtro.cartaoId) condicoes.push(eq(movimentoTabela.cartaoId, filtro.cartaoId));
    if (filtro.categoriaId) condicoes.push(eq(movimentoTabela.categoriaId, filtro.categoriaId));
    if (filtro.pessoaId) condicoes.push(eq(movimentoTabela.pessoaId, filtro.pessoaId));
    if (filtro.tipos?.length) condicoes.push(inArray(movimentoTabela.tipo, filtro.tipos));
    if (filtro.periodo) {
      condicoes.push(gte(movimentoTabela.dataMovimento, filtro.periodo.de));
      condicoes.push(lte(movimentoTabela.dataMovimento, filtro.periodo.ate));
    }

    return this.banco
      .select()
      .from(movimentoTabela)
      .where(and(...condicoes));
  }

  async listarParcelas(usuarioId: string, filtro: FiltroParcelas): Promise<ParcelaComMovimento[]> {
    const escopo = await resolver_escopo_leitura(this.banco, usuarioId);
    if (escopo.workspaceIds.length === 0) return [];
    const condicoes = [
      eq(movimentoTabela.usuarioId, usuarioId),
      inArray(movimentoTabela.workspaceId, escopo.workspaceIds),
    ];
    condicoes.push(notInArray(parcelaTabela.status, filtro.statusExcluir ?? ["cancelado"]));
    if (filtro.cartaoId) condicoes.push(eq(movimentoTabela.cartaoId, filtro.cartaoId));
    if (filtro.periodo) {
      condicoes.push(gte(parcelaTabela.dataMovimento, filtro.periodo.de));
      condicoes.push(lte(parcelaTabela.dataMovimento, filtro.periodo.ate));
    }

    const linhas = await this.banco
      .select({ parcela: parcelaTabela, movimento: movimentoTabela })
      .from(parcelaTabela)
      .innerJoin(movimentoTabela, eq(parcelaTabela.movimentoId, movimentoTabela.id))
      .where(and(...condicoes));

    return linhas.map((linha) => ({ ...linha.parcela, movimento: linha.movimento }));
  }
}
