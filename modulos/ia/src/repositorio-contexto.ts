import type { Cartao, Categoria, Conta, Movimento, Pessoa } from "@lancai/banco";

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

  /** Usado por CORRIGIR_MOVIMENTO para localizar o lançamento alvo pela descrição/data. */
  buscarMovimentoParaCorrecao(
    usuarioId: string,
    referencia: ReferenciaMovimentoParaCorrecao,
  ): Promise<Movimento | undefined>;
}
