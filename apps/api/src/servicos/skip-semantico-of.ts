import { and, eq, inArray, ne, or, isNull } from "drizzle-orm";
import { movimento, obter_banco } from "@lancai/banco";
import type { EventoFinanceiroNormalizado } from "@lancai/tipos";
import { paraNumero } from "@lancai/tipos";
import { score_descricao_conciliacao } from "./conciliar-manual-com-fonte";

/** Limiar alto: só pula quando a descrição é claramente a mesma tx. */
const LIMIAR_SEMANTICO = 0.7;

type AlvoSemantico = {
  contaId?: string | null;
  cartaoId?: string | null;
  tipo: string;
  valor: number | string;
  data: string;
  descricaoFonte?: string | null;
  favorecidoFonte?: string | null;
};

function casam_semanticos(evento: EventoFinanceiroNormalizado, alvo: AlvoSemantico): boolean {
  if ((alvo.contaId ?? null) !== (evento.contaId ?? null)) return false;
  if ((alvo.cartaoId ?? null) !== (evento.cartaoId ?? null)) return false;
  if (alvo.tipo !== evento.tipo) return false;
  if (String(alvo.data).slice(0, 10) !== String(evento.ocorridoEm).slice(0, 10)) return false;
  if (paraNumero(alvo.valor) !== paraNumero(evento.valor)) return false;
  const score = score_descricao_conciliacao(
    [alvo.descricaoFonte, alvo.favorecidoFonte].filter(Boolean).join(" "),
    evento.descricaoFonte ?? "",
    evento.favorecidoFonte,
  );
  return score >= LIMIAR_SEMANTICO;
}

/**
 * Dois idExterno no mesmo lote (Pix PREVER duas vezes no dump da Pluggy)
 * não podem virar dois Fatos.
 */
export function colapsar_lote_semantico(
  eventos: EventoFinanceiroNormalizado[],
): { aceitos: EventoFinanceiroNormalizado[]; pulados: number } {
  const aceitos: EventoFinanceiroNormalizado[] = [];
  let pulados = 0;
  for (const evento of eventos) {
    const duplicado = aceitos.some((ja) =>
      casam_semanticos(evento, {
        contaId: ja.contaId,
        cartaoId: ja.cartaoId,
        tipo: ja.tipo,
        valor: ja.valor,
        data: ja.ocorridoEm,
        descricaoFonte: ja.descricaoFonte,
        favorecidoFonte: ja.favorecidoFonte,
      }),
    );
    if (duplicado) {
      pulados += 1;
      continue;
    }
    aceitos.push(evento);
  }
  return { aceitos, pulados };
}

/**
 * No reatachar (novo itemId Pluggy), txs podem chegar com id_externo novo mas
 * serem as mesmas do histórico local. Se data + valor + tipo + descrição batem
 * com Fato OF já existente no mesmo destino, não cria — preserva categorias.
 * Também colapsa o próprio lote (dois IDs Pluggy da mesma tx).
 */
export async function filtrar_criacao_semantica_of(
  eventos: EventoFinanceiroNormalizado[],
): Promise<{ aceitos: EventoFinanceiroNormalizado[]; pulados: number }> {
  const lote = colapsar_lote_semantico(eventos);
  if (lote.aceitos.length === 0) return lote;

  const contaIds = [
    ...new Set(lote.aceitos.map((e) => e.contaId).filter((id): id is string => Boolean(id))),
  ];
  const cartaoIds = [
    ...new Set(lote.aceitos.map((e) => e.cartaoId).filter((id): id is string => Boolean(id))),
  ];

  if (contaIds.length === 0 && cartaoIds.length === 0) {
    return lote;
  }

  const banco = obter_banco();
  const filtroDestino = [
    ...(contaIds.length > 0 ? [inArray(movimento.contaId, contaIds)] : []),
    ...(cartaoIds.length > 0 ? [inArray(movimento.cartaoId, cartaoIds)] : []),
  ];

  const existentes = await banco
    .select({
      id: movimento.id,
      contaId: movimento.contaId,
      cartaoId: movimento.cartaoId,
      tipo: movimento.tipo,
      valor: movimento.valor,
      dataMovimento: movimento.dataMovimento,
      descricaoFonte: movimento.descricaoFonte,
      favorecidoFonte: movimento.favorecidoFonte,
    })
    .from(movimento)
    .where(
      and(
        eq(movimento.fonte, "open_finance"),
        ne(movimento.status, "cancelado"),
        or(isNull(movimento.statusFonte), ne(movimento.statusFonte, "removido")),
        or(...filtroDestino),
      ),
    );

  const usados = new Set<string>();
  const aceitos: EventoFinanceiroNormalizado[] = [];
  let pulados = lote.pulados;

  for (const evento of lote.aceitos) {
    const match = existentes.find((ex) => {
      if (usados.has(ex.id)) return false;
      return casam_semanticos(evento, {
        contaId: ex.contaId,
        cartaoId: ex.cartaoId,
        tipo: ex.tipo,
        valor: ex.valor,
        data: String(ex.dataMovimento),
        descricaoFonte: ex.descricaoFonte,
        favorecidoFonte: ex.favorecidoFonte,
      });
    });

    if (match) {
      usados.add(match.id);
      pulados += 1;
      continue;
    }
    aceitos.push(evento);
  }

  return { aceitos, pulados };
}
