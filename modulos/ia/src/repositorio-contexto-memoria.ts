import { randomUUID } from "node:crypto";
import type { Cartao, Categoria, Conta, Movimento, Pessoa } from "@lancai/banco";
import { calcularMelhorDiaCompra } from "@lancai/tipos";
import type { EntradaAtualizarCartao, EntradaAtualizarConta, EntradaCriarCartao, EntradaCriarConta } from "@lancai/tipos";
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
    return [...this.contas.values()].filter((conta) => conta.usuarioId === usuarioId && conta.ativo);
  }

  async listarCartoes(usuarioId: string) {
    return [...this.cartoes.values()].filter((cartao) => cartao.usuarioId === usuarioId && cartao.ativo);
  }

  async listarCategorias(usuarioId: string) {
    return [...this.categorias.values()].filter((categoria) => categoria.usuarioId === usuarioId);
  }

  async listarPessoas(usuarioId: string) {
    return [...this.pessoas.values()].filter((pessoa) => pessoa.usuarioId === usuarioId);
  }

  async buscarContaPorNome(usuarioId: string, nome: string) {
    return [...this.contas.values()].find(
      (conta) => conta.usuarioId === usuarioId && conta.ativo && correspondeAoNome(conta.nome, nome),
    );
  }

  async buscarCartaoPorNome(usuarioId: string, nome: string) {
    return [...this.cartoes.values()].find(
      (cartao) => cartao.usuarioId === usuarioId && cartao.ativo && correspondeAoNome(cartao.nome, nome),
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

  async criarConta(dados: EntradaCriarConta): Promise<Conta> {
    const agora = new Date();
    const conta: Conta = {
      id: randomUUID(),
      nome: dados.nome,
      perfil: dados.perfil,
      usuarioId: dados.usuarioId,
      saldoInicial: String(dados.saldoInicial),
      saldoAtual: String(dados.saldoInicial),
      ativo: true,
      dataCriacao: agora,
      dataAtualizacao: agora,
    };
    this.contas.set(conta.id, conta);
    return conta;
  }

  async criarCartao(dados: EntradaCriarCartao): Promise<Cartao> {
    const agora = new Date();
    const cartao: Cartao = {
      id: randomUUID(),
      nome: dados.nome,
      limite: String(dados.limite),
      fechamento: dados.fechamento,
      vencimento: dados.vencimento,
      melhorDiaCompra: calcularMelhorDiaCompra(dados.fechamento),
      perfil: dados.perfil,
      contaId: dados.contaId,
      usuarioId: dados.usuarioId,
      ativo: true,
      final4: dados.final4 ?? null,
      dadosPlasticosCifrados: dados.dadosPlasticosCifrados ?? null,
      dataCriacao: agora,
      dataAtualizacao: agora,
    };
    this.cartoes.set(cartao.id, cartao);
    return cartao;
  }

  async atualizarConta(usuarioId: string, contaId: string, dados: EntradaAtualizarConta): Promise<Conta> {
    const conta = this.contas.get(contaId);
    if (!conta || conta.usuarioId !== usuarioId) throw new Error("Conta não encontrada.");
    const atualizada: Conta = {
      ...conta,
      nome: dados.nome ?? conta.nome,
      saldoAtual: dados.saldoAtual != null ? String(dados.saldoAtual) : conta.saldoAtual,
      perfil: dados.perfil ?? conta.perfil,
      ativo: dados.ativo ?? conta.ativo,
      dataAtualizacao: new Date(),
    };
    this.contas.set(contaId, atualizada);
    return atualizada;
  }

  async atualizarCartao(usuarioId: string, cartaoId: string, dados: EntradaAtualizarCartao): Promise<Cartao> {
    const cartao = this.cartoes.get(cartaoId);
    if (!cartao || cartao.usuarioId !== usuarioId) throw new Error("Cartão não encontrado.");
    const fechamento = dados.fechamento ?? cartao.fechamento;
    const atualizado: Cartao = {
      ...cartao,
      nome: dados.nome ?? cartao.nome,
      limite: dados.limite != null ? String(dados.limite) : cartao.limite,
      fechamento,
      vencimento: dados.vencimento ?? cartao.vencimento,
      melhorDiaCompra: dados.fechamento != null ? calcularMelhorDiaCompra(fechamento) : cartao.melhorDiaCompra,
      perfil: dados.perfil ?? cartao.perfil,
      contaId: dados.contaId ?? cartao.contaId,
      ativo: dados.ativo ?? cartao.ativo,
      final4: dados.final4 ?? cartao.final4,
      dadosPlasticosCifrados: dados.dadosPlasticosCifrados ?? cartao.dadosPlasticosCifrados,
      dataAtualizacao: new Date(),
    };
    this.cartoes.set(cartaoId, atualizado);
    return atualizado;
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

  async contarMovimentosVinculadosConta(contaId: string): Promise<number> {
    return [...this.movimentos.values()].filter(
      (movimento) => movimento.contaId === contaId && movimento.status !== "cancelado",
    ).length;
  }

  async contarMovimentosVinculadosCartao(cartaoId: string): Promise<number> {
    return [...this.movimentos.values()].filter(
      (movimento) => movimento.cartaoId === cartaoId && movimento.status !== "cancelado",
    ).length;
  }
}
