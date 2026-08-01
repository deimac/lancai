import { randomUUID } from "node:crypto";
import type { Cartao, Categoria, Conta, Movimento, Pessoa } from "@lancai/banco";
import type { ReferenciaMovimentoParaCorrecao, RepositorioContexto } from "./repositorio-contexto";

function correspondeAoNome(nomeArmazenado: string, nomeBuscado: string): boolean {
  return nomeArmazenado.toLowerCase().includes(nomeBuscado.toLowerCase());
}

/** Implementação em memória do RepositorioContexto, usada exclusivamente em testes. */
export class RepositorioContextoEmMemoria implements RepositorioContexto {
  readonly contas = new Map<string, Conta>();
  readonly cartoes = new Map<string, Cartao>();
  readonly categorias = new Map<string, Categoria>();
  readonly pessoas = new Map<string, Pessoa>();
  readonly movimentos = new Map<string, Movimento>();

  async listarContas(usuarioId: string) {
    return [...this.contas.values()].filter((conta) => conta.usuarioId === usuarioId);
  }

  async listarCartoes(usuarioId: string) {
    return [...this.cartoes.values()].filter((cartao) => cartao.usuarioId === usuarioId);
  }

  async listarCategorias(usuarioId: string) {
    return [...this.categorias.values()].filter((categoria) => categoria.usuarioId === usuarioId);
  }

  async listarPessoas(usuarioId: string) {
    return [...this.pessoas.values()].filter((pessoa) => pessoa.usuarioId === usuarioId);
  }

  async buscarContaPorNome(usuarioId: string, nome: string) {
    return [...this.contas.values()].find(
      (conta) => conta.usuarioId === usuarioId && correspondeAoNome(conta.nome, nome),
    );
  }

  async buscarCartaoPorNome(usuarioId: string, nome: string) {
    return [...this.cartoes.values()].find(
      (cartao) => cartao.usuarioId === usuarioId && correspondeAoNome(cartao.nome, nome),
    );
  }

  async buscarCategoriaPorNome(usuarioId: string, nome: string) {
    return [...this.categorias.values()].find(
      (categoria) => categoria.usuarioId === usuarioId && correspondeAoNome(categoria.nome, nome),
    );
  }

  async buscarPessoaPorNome(usuarioId: string, nome: string) {
    return [...this.pessoas.values()].find(
      (pessoa) => pessoa.usuarioId === usuarioId && correspondeAoNome(pessoa.nome, nome),
    );
  }

  async criarCategoria(usuarioId: string, nome: string, tipo: Categoria["tipo"]): Promise<Categoria> {
    const agora = new Date();
    const categoria: Categoria = { id: randomUUID(), nome, tipo, ativo: true, usuarioId, dataCriacao: agora, dataAtualizacao: agora };
    this.categorias.set(categoria.id, categoria);
    return categoria;
  }

  async criarPessoa(usuarioId: string, nome: string, tipo: Pessoa["tipo"]): Promise<Pessoa> {
    const agora = new Date();
    const pessoa: Pessoa = { id: randomUUID(), nome, tipo, ativo: true, usuarioId, dataCriacao: agora, dataAtualizacao: agora };
    this.pessoas.set(pessoa.id, pessoa);
    return pessoa;
  }

  async buscarMovimentoParaCorrecao(usuarioId: string, referencia: ReferenciaMovimentoParaCorrecao) {
    const candidatos = [...this.movimentos.values()].filter((movimento) => {
      if (movimento.usuarioId !== usuarioId || movimento.status === "cancelado") return false;
      if (referencia.descricao && !correspondeAoNome(movimento.descricao, referencia.descricao)) return false;
      if (referencia.dataMovimento && movimento.dataMovimento !== referencia.dataMovimento) return false;
      return true;
    });
    candidatos.sort((a, b) => b.dataLancamento.getTime() - a.dataLancamento.getTime());
    return candidatos[0];
  }
}
