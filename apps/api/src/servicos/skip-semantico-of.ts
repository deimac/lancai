import { and, eq, inArray, ne, or, isNull } from "drizzle-orm";
import { movimento, obter_banco } from "@lancai/banco";
import type { EventoFinanceiroNormalizado } from "@lancai/tipos";
import { paraNumero } from "@lancai/tipos";
import { score_descricao_conciliacao } from "./conciliar-manual-com-fonte";

/** Limiar alto: só pula quando a descrição é claramente a mesma tx. */
const LIMIAR_SEMANTICO = 0.7;

/**
 * No reatachar (novo itemId Pluggy), txs podem chegar com id_externo novo mas
 * serem as mesmas do histórico local. Se data + valor + tipo + descrição batem
 * com Fato OF já existente no mesmo destino, não cria — preserva categorias.
 */
export async function filtrar_criacao_semantica_of(
  eventos: EventoFinanceiroNormalizado[],
): Promise<{ aceitos: EventoFinanceiroNormalizado[]; pulados: number }> {
  if (eventos.length === 0) return { aceitos: [], pulados: 0 };

  const contaIds = [
    ...new Set(eventos.map((e) => e.contaId).filter((id): id is string => Boolean(id))),
  ];
  const cartaoIds = [
    ...new Set(eventos.map((e) => e.cartaoId).filter((id): id is string => Boolean(id))),
  ];

  if (contaIds.length === 0 && cartaoIds.length === 0) {
    return { aceitos: eventos, pulados: 0 };
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
  let pulados = 0;

  for (const evento of eventos) {
    const data = String(evento.ocorridoEm).slice(0, 10);
    const valor = paraNumero(evento.valor);
    const match = existentes.find((ex) => {
      if (usados.has(ex.id)) return false;
      if ((ex.contaId ?? null) !== (evento.contaId ?? null)) return false;
      if ((ex.cartaoId ?? null) !== (evento.cartaoId ?? null)) return false;
      if (ex.tipo !== evento.tipo) return false;
      if (String(ex.dataMovimento).slice(0, 10) !== data) return false;
      if (paraNumero(ex.valor) !== valor) return false;

      const score = score_descricao_conciliacao(
        [ex.descricaoFonte, ex.favorecidoFonte].filter(Boolean).join(" "),
        evento.descricaoFonte ?? "",
        evento.favorecidoFonte,
      );
      return score >= LIMIAR_SEMANTICO;
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
