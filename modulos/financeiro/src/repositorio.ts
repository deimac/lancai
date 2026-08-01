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
  /** Soma de parcelas com status 'previsto' ou 'realizado' (não canceladas) de um cartão. */
  obterTotalComprometidoCartao(cartaoId: string): Promise<number>;
  persistirOperacao(operacao: OperacaoPersistencia): Promise<ResultadoOperacaoPersistencia>;
  atualizarMovimento(
    id: string,
    campos: Partial<NovoMovimento>,
    auditoria: NovaAuditoria,
  ): Promise<Movimento>;
}

export type { Auditoria, Cartao, Categoria, Conta, Movimento, NovoMovimento, Parcela, Pessoa };
