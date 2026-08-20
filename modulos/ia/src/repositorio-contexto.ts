import type { Cartao, Categoria, Conta, Movimento, Pessoa } from "@lancai/banco";
import type { EntradaAtualizarCartao, EntradaAtualizarConta, EntradaCriarCartao, EntradaCriarConta } from "@lancai/tipos";

export interface ReferenciaMovimentoParaCorrecao {
  descricao?: string;
  dataMovimento?: string;
  /** Código curto do lançamento (`#a1b2c3d4` ou hex). */
  codigo?: string;
}

export interface CriterioMovimentoSimilar {
  descricao: string;
  valor: number;
  dataMovimento: string;
  contaId?: string | null;
  cartaoId?: string | null;
}

/**
 * Porta de leitura/escrita usada pelo `ResolvedorIntencao` para traduzir os
 * nomes em texto livre que a IA devolve (ex.: "Nubank", "Combustível") para
 * IDs reais do banco — e, quando apropriado (categoria/pessoa), criá-los.
 *
 * Diferente do `RepositorioFinanceiro` (modulos/financeiro): este é focado em
 * busca por nome/contexto, não em persistir movimentos/saldos.
 */
export interface RepositorioContexto {
  listarContas(usuarioId: string): Promise<Conta[]>;
  listarCartoes(usuarioId: string): Promise<Cartao[]>;
  listarCategorias(usuarioId: string): Promise<Categoria[]>;
  listarPessoas(usuarioId: string): Promise<Pessoa[]>;

  buscarContaPorNome(usuarioId: string, nome: string): Promise<Conta | undefined>;
  buscarCartaoPorNome(usuarioId: string, nome: string): Promise<Cartao | undefined>;
  buscarCategoriaPorNome(usuarioId: string, nome: string): Promise<Categoria | undefined>;
  buscarPessoaPorNome(usuarioId: string, nome: string): Promise<Pessoa | undefined>;

  criarCategoria(
    usuarioId: string,
    nome: string,
    tipo: Categoria["tipo"],
    icone?: string,
    cor?: string,
  ): Promise<Categoria>;
  criarPessoa(usuarioId: string, nome: string, tipo: Pessoa["tipo"]): Promise<Pessoa>;

  /** Usado pelo onboarding conversacional (CRIAR_CONTA) — mesma regra de negócio do POST /contas. */
  criarConta(dados: EntradaCriarConta): Promise<Conta>;
  /** Usado pelo onboarding conversacional (CRIAR_CARTAO) — mesma regra de negócio do POST /cartoes. */
  criarCartao(dados: EntradaCriarCartao): Promise<Cartao>;

  /** Usado por CORRIGIR_CONTA para atualizar uma conta já existente (nome, saldo e/ou perfil). */
  atualizarConta(usuarioId: string, contaId: string, dados: EntradaAtualizarConta): Promise<Conta>;
  /** Usado por CORRIGIR_CARTAO para atualizar um cartão já existente. */
  atualizarCartao(usuarioId: string, cartaoId: string, dados: EntradaAtualizarCartao): Promise<Cartao>;

  /** Usado por CORRIGIR_MOVIMENTO para localizar o lançamento alvo pela descrição/data. */
  buscarMovimentoParaCorrecao(
    usuarioId: string,
    referencia: ReferenciaMovimentoParaCorrecao,
  ): Promise<Movimento | undefined>;

  /**
   * Lista todos os lançamentos que batem com a referência (descrição normalizada + data opcional).
   * Usado para cancelar vários iguais de uma vez (ex.: farmácia duplicada).
   */
  listarMovimentosParaCorrecao(
    usuarioId: string,
    referencia: ReferenciaMovimentoParaCorrecao,
  ): Promise<Movimento[]>;

  /**
   * Busca lançamento não cancelado com mesmo valor, data, descrição (sem acento/caixa)
   * e mesma conta ou cartão — usado para avisar duplicata antes de registrar.
   */
  buscarMovimentoSimilar(
    usuarioId: string,
    criterio: CriterioMovimentoSimilar,
  ): Promise<Movimento | undefined>;

  /** Contagem de lançamentos não cancelados vinculados à conta (para aviso na exclusão). */
  contarMovimentosVinculadosConta(contaId: string): Promise<number>;
  /** Contagem de lançamentos não cancelados vinculados ao cartão (para aviso na exclusão). */
  contarMovimentosVinculadosCartao(cartaoId: string): Promise<number>;
}
