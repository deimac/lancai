import { and, eq, inArray, or } from "drizzle-orm";
import {
  cartao,
  conta,
  movimento,
  obter_banco,
  parcela,
  recorrencia,
} from "@lancai/banco";
import {
  ProvedorDuble,
  RepositorioOpenFinanceDrizzle,
  ServicoConexaoOpenFinance,
} from "@lancai/open-finance";
import { MotorFinanceiro, RepositorioFinanceiroDrizzle } from "@lancai/financeiro";
import { obter_provedor_open_finance } from "./open-finance";

/**
 * Exclusão total de conta/cartão:
 * - se veio de Open Finance, apaga a conexão e todos os recursos da instituição;
 * - apaga parcelas e movimentos ligados;
 * - apaga as contas/cartões (não só `ativo=false`).
 *
 * Exceção deliberada ao append-only do dia a dia: o botão Excluir é limpeza
 * para reconectar, não cancelamento de um lançamento.
 */
export async function excluir_destino_financeiro(entrada: {
  usuarioId: string;
  workspaceIds: string[];
  contaId?: string;
  cartaoId?: string;
}): Promise<{ contaIds: string[]; cartaoIds: string[] }> {
  const provedor = obter_provedor_open_finance() ?? new ProvedorDuble();
  const servico = new ServicoConexaoOpenFinance(
    provedor,
    new RepositorioOpenFinanceDrizzle(),
    new MotorFinanceiro(new RepositorioFinanceiroDrizzle()),
  );

  const cascade = await servico.excluir_por_destino({
    contaId: entrada.contaId,
    cartaoId: entrada.cartaoId,
  });

  const contaIds = cascade.contaIds.length
    ? cascade.contaIds
    : entrada.contaId
      ? [entrada.contaId]
      : [];
  const cartaoIds = cascade.cartaoIds.length
    ? cascade.cartaoIds
    : entrada.cartaoId
      ? [entrada.cartaoId]
      : [];

  const banco = obter_banco();
  const agora = new Date();

  if (contaIds.length > 0) {
    await banco
      .update(recorrencia)
      .set({ contaId: null, dataAtualizacao: agora })
      .where(
        and(eq(recorrencia.usuarioId, entrada.usuarioId), inArray(recorrencia.contaId, contaIds)),
      );
  }
  if (cartaoIds.length > 0) {
    await banco
      .update(recorrencia)
      .set({ cartaoId: null, dataAtualizacao: agora })
      .where(
        and(eq(recorrencia.usuarioId, entrada.usuarioId), inArray(recorrencia.cartaoId, cartaoIds)),
      );
  }

  const filtroMovimento = [
    ...(contaIds.length > 0 ? [inArray(movimento.contaId, contaIds)] : []),
    ...(cartaoIds.length > 0 ? [inArray(movimento.cartaoId, cartaoIds)] : []),
  ];

  if (filtroMovimento.length > 0) {
    const movimentosAlvo = await banco
      .select({ id: movimento.id })
      .from(movimento)
      .where(
        and(
          eq(movimento.usuarioId, entrada.usuarioId),
          inArray(movimento.workspaceId, entrada.workspaceIds),
          or(...filtroMovimento),
        ),
      );

    const movimentoIds = movimentosAlvo.map((m) => m.id);
    if (movimentoIds.length > 0) {
      await banco.delete(parcela).where(inArray(parcela.movimentoId, movimentoIds));
      await banco.delete(movimento).where(inArray(movimento.id, movimentoIds));
    }
  }

  if (contaIds.length > 0) {
    await banco
      .update(cartao)
      .set({ contaId: null, dataAtualizacao: agora })
      .where(
        and(eq(cartao.usuarioId, entrada.usuarioId), inArray(cartao.contaId, contaIds)),
      );
  }

  if (cartaoIds.length > 0) {
    await banco
      .delete(cartao)
      .where(
        and(
          inArray(cartao.id, cartaoIds),
          eq(cartao.usuarioId, entrada.usuarioId),
          inArray(cartao.workspaceId, entrada.workspaceIds),
        ),
      );
  }

  if (contaIds.length > 0) {
    await banco
      .delete(conta)
      .where(
        and(
          inArray(conta.id, contaIds),
          eq(conta.usuarioId, entrada.usuarioId),
          inArray(conta.workspaceId, entrada.workspaceIds),
        ),
      );
  }

  return { contaIds, cartaoIds };
}
