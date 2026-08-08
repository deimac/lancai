import { MotorFinanceiro, RepositorioFinanceiroDrizzle } from "@lancai/financeiro";
import {
  criar_provedor_open_finance,
  RepositorioOpenFinanceDrizzle,
  ServicoConexaoOpenFinance,
  ServicoIngestaoOpenFinance,
} from "@lancai/open-finance";
import type { ProvedorOpenFinance } from "@lancai/open-finance";

/**
 * Qual provedor está ativo é decidido por variável de ambiente, não por código
 * (seção 9 de 13-OPEN_FINANCE.md). Sem `OPEN_FINANCE_PROVEDOR` a Fonte está
 * desligada e a rota de webhook responde 503 — nada de provedor de mentira
 * ligado por descuido em produção.
 *
 * Quem traduz o nome em adaptador é o próprio módulo: esta aplicação passa a
 * variável adiante e não conhece nenhum provedor pelo nome (ADR-011).
 */
let provedorAtivo: ProvedorOpenFinance | null | undefined;

export function obter_provedor_open_finance(): ProvedorOpenFinance | null {
  if (provedorAtivo === undefined) {
    provedorAtivo = criar_provedor_open_finance(process.env.OPEN_FINANCE_PROVEDOR);
  }
  return provedorAtivo;
}

export function obter_servico_ingestao(): ServicoIngestaoOpenFinance | null {
  const provedor = obter_provedor_open_finance();
  if (!provedor) return null;

  return new ServicoIngestaoOpenFinance(
    provedor,
    new RepositorioOpenFinanceDrizzle(),
    new MotorFinanceiro(new RepositorioFinanceiroDrizzle()),
  );
}

export function obter_servico_conexao(): ServicoConexaoOpenFinance | null {
  const provedor = obter_provedor_open_finance();
  if (!provedor) return null;

  return new ServicoConexaoOpenFinance(
    provedor,
    new RepositorioOpenFinanceDrizzle(),
    new MotorFinanceiro(new RepositorioFinanceiroDrizzle()),
  );
}
