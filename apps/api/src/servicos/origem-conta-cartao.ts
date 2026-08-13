import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  movimento,
  openFinanceConexao,
  openFinanceContaExterna,
  obter_banco,
} from "@lancai/banco";

export type OrigemFinanceira = "manual" | "open_finance";

export type StatusConexaoOrigem =
  | "ativa"
  | "sincronizando"
  | "precisa_atencao"
  | "removida";

export type MetaOrigem = {
  origem: OrigemFinanceira;
  conexaoId: string | null;
  instituicao: string | null;
  idExterno: string | null;
  conexaoStatus: StatusConexaoOrigem | null;
  ultimoSyncEm: Date | null;
};

const META_MANUAL: MetaOrigem = {
  origem: "manual",
  conexaoId: null,
  instituicao: null,
  idExterno: null,
  conexaoStatus: null,
  ultimoSyncEm: null,
};

/** Conexão sumiu; o Fato Open Finance na conta/cartão ainda existe. */
const META_OF_ORFAO: MetaOrigem = {
  origem: "open_finance",
  conexaoId: null,
  instituicao: null,
  idExterno: null,
  conexaoStatus: "removida",
  ultimoSyncEm: null,
};

/**
 * Se o mapa não achou origem OF, o Fato (movimento fonte open_finance) ainda
 * prova que a conta/cartão veio da instituição — não é cadastro manual.
 */
export function aplicar_fatos_open_finance(
  mapa: Map<string, MetaOrigem>,
  idsComFato: Iterable<string>,
): void {
  for (const id of idsComFato) {
    const atual = mapa.get(id);
    if (!atual || atual.origem === "open_finance") continue;
    mapa.set(id, { ...META_OF_ORFAO });
  }
}

/**
 * Enriquece listagens de conta/cartão com origem derivada do mapa Open Finance
 * e, na falta do mapa, do Fato já ingerido.
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
      conexaoStatus: openFinanceConexao.status,
      ultimoSyncEm: openFinanceConexao.ultimoSyncEm,
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
      conexaoStatus: linha.conexaoStatus,
      ultimoSyncEm: linha.ultimoSyncEm,
    });
  }

  const orfas = contaIds.filter((id) => mapa.get(id)?.origem !== "open_finance");
  if (orfas.length > 0) {
    const fatos = await banco
      .selectDistinct({ contaId: movimento.contaId })
      .from(movimento)
      .where(and(eq(movimento.fonte, "open_finance"), inArray(movimento.contaId, orfas)));
    aplicar_fatos_open_finance(
      mapa,
      fatos.map((f) => f.contaId).filter((id): id is string => Boolean(id)),
    );
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
      conexaoStatus: openFinanceConexao.status,
      ultimoSyncEm: openFinanceConexao.ultimoSyncEm,
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
      conexaoStatus: linha.conexaoStatus,
      ultimoSyncEm: linha.ultimoSyncEm,
    });
  }

  const orfas = cartaoIds.filter((id) => mapa.get(id)?.origem !== "open_finance");
  if (orfas.length > 0) {
    const fatos = await banco
      .selectDistinct({ cartaoId: movimento.cartaoId })
      .from(movimento)
      .where(and(eq(movimento.fonte, "open_finance"), inArray(movimento.cartaoId, orfas)));
    aplicar_fatos_open_finance(
      mapa,
      fatos.map((f) => f.cartaoId).filter((id): id is string => Boolean(id)),
    );
  }

  return mapa;
}
