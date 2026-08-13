import { and, eq, inArray, or, sql } from "drizzle-orm";
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
 * Exclusão total (hard-delete) de conta/cartão:
 * - se veio de Open Finance, apaga a conexão e os recursos ligados da instituição;
 * - apaga parcelas e movimentos (incl. Fatos OF, via escape `lancai.sincronizacao`);
 * - apaga as contas/cartões (não só `ativo=false`).
 *
 * Exceção deliberada ao append-only: o botão Excluir é limpeza explícita do
 * usuário. Para só trocar o itemId, use Reconectar banco.
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

  await banco.transaction(async (tx) => {
    /**
     * Mesmo escape do Core na sync: permite DELETE de Fatos `open_finance`.
     * `LOCAL` amarra à transação — fecha no commit/rollback.
     */
    await tx.execute(sql`SET LOCAL "lancai.sincronizacao" = 'on'`);

    const agora = new Date();

    if (contaIds.length > 0) {
      await tx
        .update(recorrencia)
        .set({ contaId: null, dataAtualizacao: agora })
        .where(
          and(eq(recorrencia.usuarioId, entrada.usuarioId), inArray(recorrencia.contaId, contaIds)),
        );
    }
    if (cartaoIds.length > 0) {
      await tx
        .update(recorrencia)
        .set({ cartaoId: null, dataAtualizacao: agora })
        .where(
          and(
            eq(recorrencia.usuarioId, entrada.usuarioId),
            inArray(recorrencia.cartaoId, cartaoIds),
          ),
        );
    }

    const filtroMovimento = [
      ...(contaIds.length > 0 ? [inArray(movimento.contaId, contaIds)] : []),
      ...(cartaoIds.length > 0 ? [inArray(movimento.cartaoId, cartaoIds)] : []),
    ];

    if (filtroMovimento.length > 0) {
      const movimentosAlvo = await tx
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
        await tx.delete(parcela).where(inArray(parcela.movimentoId, movimentoIds));
        await tx.delete(movimento).where(inArray(movimento.id, movimentoIds));
      }
    }

    if (contaIds.length > 0) {
      await tx
        .update(cartao)
        .set({ contaId: null, dataAtualizacao: agora })
        .where(
          and(eq(cartao.usuarioId, entrada.usuarioId), inArray(cartao.contaId, contaIds)),
        );
    }

    if (cartaoIds.length > 0) {
      await tx
        .delete(cartao)
        .where(
          and(inArray(cartao.id, cartaoIds), eq(cartao.usuarioId, entrada.usuarioId)),
        );
    }

    if (contaIds.length > 0) {
      await tx
        .delete(conta)
        .where(and(inArray(conta.id, contaIds), eq(conta.usuarioId, entrada.usuarioId)));
    }
  });

  return { contaIds, cartaoIds };
}
