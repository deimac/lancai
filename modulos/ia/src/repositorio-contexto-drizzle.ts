import { and, desc, eq, ilike, ne } from "drizzle-orm";
import {
  cartao as cartaoTabela,
  categoria as categoriaTabela,
  conta as contaTabela,
  movimento as movimentoTabela,
  obter_banco,
  pessoa as pessoaTabela,
} from "@lancai/banco";
import type { Cartao, Categoria, Conta, Movimento, Pessoa } from "@lancai/banco";
import type { ReferenciaMovimentoParaCorrecao, RepositorioContexto } from "./repositorio-contexto";

export class RepositorioContextoDrizzle implements RepositorioContexto {
  private get banco() {
    return obter_banco();
  }

  async listarContas(usuarioId: string): Promise<Conta[]> {
    return this.banco
      .select()
      .from(contaTabela)
      .where(and(eq(contaTabela.usuarioId, usuarioId), eq(contaTabela.ativo, true)));
  }

  async listarCartoes(usuarioId: string): Promise<Cartao[]> {
    return this.banco
      .select()
      .from(cartaoTabela)
      .where(and(eq(cartaoTabela.usuarioId, usuarioId), eq(cartaoTabela.ativo, true)));
  }

  async listarCategorias(usuarioId: string): Promise<Categoria[]> {
    return this.banco
      .select()
      .from(categoriaTabela)
      .where(and(eq(categoriaTabela.usuarioId, usuarioId), eq(categoriaTabela.ativo, true)));
  }

  async listarPessoas(usuarioId: string): Promise<Pessoa[]> {
    return this.banco
      .select()
      .from(pessoaTabela)
      .where(and(eq(pessoaTabela.usuarioId, usuarioId), eq(pessoaTabela.ativo, true)));
  }

  async buscarContaPorNome(usuarioId: string, nome: string): Promise<Conta | undefined> {
    const linhas = await this.banco
      .select()
      .from(contaTabela)
      .where(and(eq(contaTabela.usuarioId, usuarioId), ilike(contaTabela.nome, `%${nome}%`)))
      .limit(1);
    return linhas[0];
  }

  async buscarCartaoPorNome(usuarioId: string, nome: string): Promise<Cartao | undefined> {
    const linhas = await this.banco
      .select()
      .from(cartaoTabela)
      .where(and(eq(cartaoTabela.usuarioId, usuarioId), ilike(cartaoTabela.nome, `%${nome}%`)))
      .limit(1);
    return linhas[0];
  }

  async buscarCategoriaPorNome(usuarioId: string, nome: string): Promise<Categoria | undefined> {
    const linhas = await this.banco
      .select()
      .from(categoriaTabela)
      .where(and(eq(categoriaTabela.usuarioId, usuarioId), ilike(categoriaTabela.nome, nome)))
      .limit(1);
    return linhas[0];
  }

  async buscarPessoaPorNome(usuarioId: string, nome: string): Promise<Pessoa | undefined> {
    const linhas = await this.banco
      .select()
      .from(pessoaTabela)
      .where(and(eq(pessoaTabela.usuarioId, usuarioId), ilike(pessoaTabela.nome, nome)))
      .limit(1);
    return linhas[0];
  }

  async criarCategoria(usuarioId: string, nome: string, tipo: Categoria["tipo"]): Promise<Categoria> {
    const linhas = await this.banco.insert(categoriaTabela).values({ usuarioId, nome, tipo }).returning();
    const categoria = linhas[0];
    if (!categoria) throw new Error("Falha ao criar categoria automaticamente.");
    return categoria;
  }

  async criarPessoa(usuarioId: string, nome: string, tipo: Pessoa["tipo"]): Promise<Pessoa> {
    const linhas = await this.banco.insert(pessoaTabela).values({ usuarioId, nome, tipo }).returning();
    const pessoa = linhas[0];
    if (!pessoa) throw new Error("Falha ao criar pessoa automaticamente.");
    return pessoa;
  }

  async buscarMovimentoParaCorrecao(
    usuarioId: string,
    referencia: ReferenciaMovimentoParaCorrecao,
  ): Promise<Movimento | undefined> {
    const condicoes = [eq(movimentoTabela.usuarioId, usuarioId), ne(movimentoTabela.status, "cancelado")];
    if (referencia.descricao) {
      condicoes.push(ilike(movimentoTabela.descricao, `%${referencia.descricao}%`));
    }
    if (referencia.dataMovimento) {
      condicoes.push(eq(movimentoTabela.dataMovimento, referencia.dataMovimento));
    }

    const linhas = await this.banco
      .select()
      .from(movimentoTabela)
      .where(and(...condicoes))
      .orderBy(desc(movimentoTabela.dataLancamento))
      .limit(1);
    return linhas[0];
  }
}
