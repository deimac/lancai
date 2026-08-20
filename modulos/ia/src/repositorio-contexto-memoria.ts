import { randomUUID } from "node:crypto";
import type { Cartao, Categoria, Conta, Movimento, Pessoa } from "@lancai/banco";
import { calcularMelhorDiaCompra, paraColuna } from "@lancai/tipos";
import type { EntradaAtualizarCartao, EntradaAtualizarConta, EntradaCriarCartao, EntradaCriarConta } from "@lancai/tipos";
import { preparar_persistencia_plasticos } from "./cifragem-cartao";
import { codigo_curto_movimento, normalizar_codigo_busca } from "./codigo-movimento";
import { chave_descricao_lancamento, descricao_corresponde_busca } from "./normalizar-descricao";
import type {
  CriterioMovimentoSimilar,
  ReferenciaMovimentoParaCorrecao,
  RepositorioContexto,
} from "./repositorio-contexto";

function correspondeAoNome(nomeArmazenado: string, nomeBuscado: string): boolean {
  return nomeArmazenado.toLowerCase().includes(nomeBuscado.toLowerCase());
}

/**
 * Workspace fixo dos testes. Enquanto cada usuário tem exatamente um workspace,
 * um valor constante representa fielmente o comportamento real.
 */
export const WORKSPACE_EM_MEMORIA = "00000000-0000-4000-8000-000000000001";

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
    const pessoa: Pessoa = { id: randomUUID(), nome, tipo, ativo: true, usuarioId, workspaceId: WORKSPACE_EM_MEMORIA, dataCriacao: agora, dataAtualizacao: agora };
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
      workspaceId: WORKSPACE_EM_MEMORIA,
      saldoInicial: String(dados.saldoInicial),
      saldoAtual: String(dados.saldoInicial),
      ativo: true,
      sincronizada: false,
      contaFinanceiraId: null,
      dataCriacao: agora,
      dataAtualizacao: agora,
    };
    this.contas.set(conta.id, conta);
    return conta;
  }

  async criarCartao(dados: EntradaCriarCartao): Promise<Cartao> {
    const agora = new Date();
    const dadosPlasticosCifrados = dados.plastico
      ? preparar_persistencia_plasticos(dados.plastico).dadosPlasticosCifrados
      : (dados.dadosPlasticosCifrados ?? null);
    const cartao: Cartao = {
      id: randomUUID(),
      nome: dados.nome,
      limite: String(dados.limite),
      saldo: String(dados.saldo ?? 0),
      fechamento: dados.fechamento,
      vencimento: dados.vencimento,
      melhorDiaCompra: calcularMelhorDiaCompra(dados.fechamento),
      perfil: dados.perfil,
      modalidade: dados.modalidade ?? (dados.contaId ? "multiplo" : "credito"),
      contaId: dados.contaId ?? null,
      usuarioId: dados.usuarioId,
      workspaceId: WORKSPACE_EM_MEMORIA,
      ativo: true,
      sincronizada: false,
      dadosPlasticosCifrados,
      contaFinanceiraId: null,
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
    const dadosPlasticosCifrados = dados.plastico
      ? preparar_persistencia_plasticos(dados.plastico).dadosPlasticosCifrados
      : (dados.dadosPlasticosCifrados ?? cartao.dadosPlasticosCifrados);
    const atualizado: Cartao = {
      ...cartao,
      nome: dados.nome ?? cartao.nome,
      limite: dados.limite != null ? String(dados.limite) : cartao.limite,
      saldo: dados.saldo != null ? String(dados.saldo) : cartao.saldo,
      fechamento,
      vencimento: dados.vencimento ?? cartao.vencimento,
      melhorDiaCompra: dados.fechamento != null ? calcularMelhorDiaCompra(fechamento) : cartao.melhorDiaCompra,
      perfil: dados.perfil ?? cartao.perfil,
      modalidade: dados.modalidade ?? cartao.modalidade,
      contaId: dados.contaId !== undefined ? dados.contaId : cartao.contaId,
      ativo: dados.ativo ?? cartao.ativo,
      dadosPlasticosCifrados,
      dataAtualizacao: new Date(),
    };
    this.cartoes.set(cartaoId, atualizado);
    return atualizado;
  }

  async listarMovimentosParaCorrecao(usuarioId: string, referencia: ReferenciaMovimentoParaCorrecao) {
    if (referencia.codigo) {
      const codigo = normalizar_codigo_busca(referencia.codigo);
      if (codigo.length >= 6) {
        const porCodigo = [...this.movimentos.values()].filter((movimento) => {
          if (movimento.usuarioId !== usuarioId || movimento.status === "cancelado") return false;
          return codigo_curto_movimento(movimento.id).startsWith(codigo) ||
            movimento.id.replace(/-/g, "").toLowerCase().startsWith(codigo);
        });
        porCodigo.sort((a, b) => b.dataLancamento.getTime() - a.dataLancamento.getTime());
        return porCodigo;
      }
    }

    const candidatos = [...this.movimentos.values()].filter((movimento) => {
      if (movimento.usuarioId !== usuarioId || movimento.status === "cancelado") return false;
      if (referencia.dataMovimento && movimento.dataMovimento !== referencia.dataMovimento) return false;
      if (referencia.descricao && !descricao_corresponde_busca(movimento.descricao, referencia.descricao)) {
        return false;
      }
      return true;
    });
    candidatos.sort((a, b) => b.dataLancamento.getTime() - a.dataLancamento.getTime());
    return candidatos;
  }

  async buscarMovimentoParaCorrecao(usuarioId: string, referencia: ReferenciaMovimentoParaCorrecao) {
    const candidatos = await this.listarMovimentosParaCorrecao(usuarioId, referencia);
    return candidatos[0];
  }

  async buscarMovimentoSimilar(usuarioId: string, criterio: CriterioMovimentoSimilar) {
    const valorAlvo = paraColuna(criterio.valor);
    const descricaoAlvo = chave_descricao_lancamento(criterio.descricao);
    const candidatos = [...this.movimentos.values()].filter((movimento) => {
      if (movimento.usuarioId !== usuarioId || movimento.status === "cancelado") return false;
      if (movimento.dataMovimento !== criterio.dataMovimento) return false;
      if (movimento.valor !== valorAlvo) return false;
      if (criterio.cartaoId && movimento.cartaoId !== criterio.cartaoId) return false;
      if (!criterio.cartaoId && criterio.contaId && movimento.contaId !== criterio.contaId) return false;
      return chave_descricao_lancamento(movimento.descricao) === descricaoAlvo;
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
