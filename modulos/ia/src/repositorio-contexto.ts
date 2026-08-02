import type { Cartao, Categoria, Conta, Movimento, Pessoa } from "@lancai/banco";
import type { EntradaAtualizarCartao, EntradaAtualizarConta, EntradaCriarCartao, EntradaCriarConta } from "@lancai/tipos";

export interface ReferenciaMovimentoParaCorrecao {
  descricao?: string;
  dataMovimento?: string;
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

  criarCategoria(usuarioId: string, nome: string, tipo: Categoria["tipo"]): Promise<Categoria>;
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

  /** Contagem de lançamentos não cancelados vinculados à conta (para aviso na exclusão). */
  contarMovimentosVinculadosConta(contaId: string): Promise<number>;
  /** Contagem de lançamentos não cancelados vinculados ao cartão (para aviso na exclusão). */
  contarMovimentosVinculadosCartao(cartaoId: string): Promise<number>;
}
