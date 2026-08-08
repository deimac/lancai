import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  openFinanceConexao,
  openFinanceContaExterna,
  obter_banco,
} from "@lancai/banco";

export type OrigemFinanceira = "manual" | "open_finance";

export type MetaOrigem = {
  origem: OrigemFinanceira;
  conexaoId: string | null;
  instituicao: string | null;
  idExterno: string | null;
};

const META_MANUAL: MetaOrigem = {
  origem: "manual",
  conexaoId: null,
  instituicao: null,
  idExterno: null,
};

/**
 * Enriquece listagens de conta/cartão com origem derivada do mapa Open Finance.
 * Conta/Cartão continuam entidades do Core; a Fonte só explica de onde vieram.
 */
export async function mapear_origem_contas(contaIds: string[]): Promise<Map<string, MetaOrigem>> {
  const mapa = new Map<string, MetaOrigem>();
  for (const id of contaIds) mapa.set(id, META_MANUAL);
  if (contaIds.length === 0) return mapa;

  const banco = obter_banco();
  const linhas = await banco
    .select({
      contaId: openFinanceContaExterna.contaId,
      conexaoId: openFinanceContaExterna.conexaoId,
      idExterno: openFinanceContaExterna.idExterno,
      instituicao: openFinanceConexao.instituicao,
    })
    .from(openFinanceContaExterna)
    .innerJoin(openFinanceConexao, eq(openFinanceContaExterna.conexaoId, openFinanceConexao.id))
    .where(
      and(isNotNull(openFinanceContaExterna.contaId), inArray(openFinanceContaExterna.contaId, contaIds)),
    );

  for (const linha of linhas) {
    if (!linha.contaId) continue;
    mapa.set(linha.contaId, {
      origem: "open_finance",
      conexaoId: linha.conexaoId,
      instituicao: linha.instituicao,
      idExterno: linha.idExterno,
    });
  }

  return mapa;
}

export async function mapear_origem_cartoes(cartaoIds: string[]): Promise<Map<string, MetaOrigem>> {
  const mapa = new Map<string, MetaOrigem>();
  for (const id of cartaoIds) mapa.set(id, META_MANUAL);
  if (cartaoIds.length === 0) return mapa;

  const banco = obter_banco();
  const linhas = await banco
    .select({
      cartaoId: openFinanceContaExterna.cartaoId,
      conexaoId: openFinanceContaExterna.conexaoId,
      idExterno: openFinanceContaExterna.idExterno,
      instituicao: openFinanceConexao.instituicao,
    })
    .from(openFinanceContaExterna)
    .innerJoin(openFinanceConexao, eq(openFinanceContaExterna.conexaoId, openFinanceConexao.id))
    .where(
      and(
        isNotNull(openFinanceContaExterna.cartaoId),
        inArray(openFinanceContaExterna.cartaoId, cartaoIds),
      ),
    );

  for (const linha of linhas) {
    if (!linha.cartaoId) continue;
    mapa.set(linha.cartaoId, {
      origem: "open_finance",
      conexaoId: linha.conexaoId,
      instituicao: linha.instituicao,
      idExterno: linha.idExterno,
    });
  }

  return mapa;
}
