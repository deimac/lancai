import type {
  Auditoria,
  Cartao,
  Categoria,
  Conta,
  Movimento,
  NovaAuditoria,
  NovaParcela,
  NovoMovimento,
  Parcela,
  Pessoa,
} from "@lancai/banco";

/**
 * Tudo que o MotorFinanceiro precisa persistir para um único lançamento
 * (ou, no caso de transferência, dois lançamentos) deve viajar atomicamente
 * dentro de uma única operação — para nunca deixar saldo e movimento
 * dessincronizados em caso de falha no meio do caminho.
 */
export interface OperacaoPersistencia {
  movimentos: NovoMovimento[];
  parcelas: NovaParcela[];
  atualizacoesSaldoConta: Array<{ contaId: string; saldoAtual: number }>;
  auditorias: NovaAuditoria[];
}

export interface ResultadoOperacaoPersistencia {
  movimentos: Movimento[];
  parcelas: Parcela[];
}

/** Tudo que uma correção de lançamento precisa persistir atomicamente. */
export interface OperacaoCorrecao {
  movimentoId: string;
  campos: Partial<NovoMovimento>;
  atualizacoesSaldoConta: Array<{ contaId: string; saldoAtual: number }>;
  auditoria: NovaAuditoria;
  /**
   * Quando true, cancela logicamente todas as parcelas não canceladas do movimento
   * e, se `novasParcelas` vier preenchido, as recria (ex.: mudar valor ou nº de parcelas).
   */
  regenerarParcelas?: {
    novasParcelas: NovaParcela[];
  };
}

/**
 * Alteração que a instituição anunciou sobre Fato já ingerido. É a única
 * operação que abre o escape hatch do trigger de imutabilidade, e por isso vem
 * em tipo próprio: uma correção manual que caísse aqui por descuido ganharia
 * permissão para reescrever extrato.
 */
export interface OperacaoAtualizacaoFonte {
  atualizacoes: Array<{ movimentoId: string; campos: Partial<NovoMovimento> }>;
  atualizacoesSaldoConta: Array<{ contaId: string; saldoAtual: number }>;
  auditorias: NovaAuditoria[];
}

/**
 * Porta de persistência do MotorFinanceiro. A implementação real vive em
 * `repositorio-drizzle.ts` (Supabase/Postgres); a implementação em memória
 * (`repositorio-memoria.ts`) existe só para os testes unitários rodarem
 * sem depender de banco de dados.
 */
export interface RepositorioFinanceiro {
  obterConta(id: string): Promise<Conta | undefined>;
  obterCartao(id: string): Promise<Cartao | undefined>;
  obterCategoria(id: string): Promise<Categoria | undefined>;
  obterPessoa(id: string): Promise<Pessoa | undefined>;
  obterMovimento(id: string): Promise<Movimento | undefined>;
  /**
   * Usado pela ingestão para não duplicar o que já entrou. Reflete o índice
   * único parcial de `movimento`; sem ele, um reprocessamento de lote geraria
   * movimentações repetidas.
   */
  obterMovimentoPorIdExterno(chave: {
    workspaceId: string;
    fonte: string;
    provedor?: string;
    idExterno: string;
  }): Promise<Movimento | undefined>;
  /** Parcelas não canceladas de um movimento (para regenerar em correções). */
  listarParcelasDoMovimento(movimentoId: string): Promise<Parcela[]>;
  /** Soma de parcelas com status 'previsto' ou 'realizado' (não canceladas) de um cartão. */
  obterTotalComprometidoCartao(cartaoId: string): Promise<number>;
  persistirOperacao(operacao: OperacaoPersistencia): Promise<ResultadoOperacaoPersistencia>;
  corrigirMovimento(operacao: OperacaoCorrecao): Promise<Movimento>;
  /**
   * Aplica alteração vinda da instituição, declarando a sincronização para o
   * trigger dentro da mesma transação. O escopo é `LOCAL`: a permissão morre com
   * a transação, e nenhuma outra escrita a herda.
   */
  atualizarFatosDaFonte(operacao: OperacaoAtualizacaoFonte): Promise<Movimento[]>;
  /**
   * Só o Core alterna a marca de conta sincronizada, porque é ele quem a lê para
   * recusar escrita manual. Ver `MotorFinanceiro.definir_sincronizacao`.
   */
  definirSincronizacaoConta(contaId: string, sincronizada: boolean): Promise<void>;
  definirSincronizacaoCartao(cartaoId: string, sincronizada: boolean): Promise<void>;
}

export type { Auditoria, Cartao, Categoria, Conta, Movimento, NovoMovimento, Parcela, Pessoa };
