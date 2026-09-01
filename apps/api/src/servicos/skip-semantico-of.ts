import { and, eq, inArray, ne, or, isNull } from "drizzle-orm";
import { movimento, obter_banco } from "@lancai/banco";
import type { EventoFinanceiroNormalizado } from "@lancai/tipos";
import { hora_visivel_do_fato, paraNumero } from "@lancai/tipos";
import { score_descricao_conciliacao } from "./conciliar-manual-com-fonte";

/** Limiar alto: só sinaliza quando a descrição é claramente a mesma tx. */
const LIMIAR_SEMANTICO = 0.7;

export type AlvoSemantico = {
  id?: string;
  contaId?: string | null;
  cartaoId?: string | null;
  tipo: string;
  valor: number | string;
  data: string;
  descricaoFonte?: string | null;
  favorecidoFonte?: string | null;
  ocorridoEmInstante?: Date | string | null;
  ignoradoEmRelatorio?: boolean;
  dataCriacao?: Date | string | null;
};

function casam_identidade(evento: EventoFinanceiroNormalizado | AlvoSemantico, alvo: AlvoSemantico): boolean {
  const contaEvento = "contaId" in evento ? (evento.contaId ?? null) : null;
  const cartaoEvento = "cartaoId" in evento ? (evento.cartaoId ?? null) : null;
  const tipoEvento = evento.tipo;
  const dataEvento =
    "ocorridoEm" in evento && typeof evento.ocorridoEm === "string"
      ? evento.ocorridoEm
      : "data" in evento
        ? String(evento.data)
        : "";
  const valorEvento = evento.valor;
  const descEvento =
    "descricaoFonte" in evento ? (evento.descricaoFonte ?? null) : null;
  const favEvento =
    "favorecidoFonte" in evento ? (evento.favorecidoFonte ?? null) : null;

  if ((alvo.contaId ?? null) !== contaEvento) return false;
  if ((alvo.cartaoId ?? null) !== cartaoEvento) return false;
  if (alvo.tipo !== tipoEvento) return false;
  if (String(alvo.data).slice(0, 10) !== String(dataEvento).slice(0, 10)) return false;
  if (paraNumero(alvo.valor) !== paraNumero(valorEvento)) return false;
  const score = score_descricao_conciliacao(
    [alvo.descricaoFonte, alvo.favorecidoFonte].filter(Boolean).join(" "),
    descEvento ?? "",
    favEvento,
  );
  return score >= LIMIAR_SEMANTICO;
}

/** Relógio que o Extrato mostra. Sem instante (ou carimbo de dia) → não pergunta. */
export function minuto_visivel_do_fato(
  data: string,
  instante?: Date | string | null,
): string | null {
  const hora = hora_visivel_do_fato(data, instante);
  return hora || null;
}

export function casam_mesmo_minuto(
  evento: EventoFinanceiroNormalizado | AlvoSemantico,
  alvo: AlvoSemantico,
): boolean {
  if (!casam_identidade(evento, alvo)) return false;
  const dataEvento =
    "ocorridoEm" in evento && typeof evento.ocorridoEm === "string"
      ? evento.ocorridoEm
      : "data" in evento
        ? String(evento.data)
        : "";
  const instanteEvento =
    "ocorridoEmInstante" in evento ? evento.ocorridoEmInstante : undefined;
  const a = minuto_visivel_do_fato(dataEvento, instanteEvento);
  const b = minuto_visivel_do_fato(alvo.data, alvo.ocorridoEmInstante);
  if (!a || !b) return false;
  return a === b;
}

function chave_item(item: EventoFinanceiroNormalizado | AlvoSemantico, indice: number): string {
  if ("id" in item && item.id) return item.id;
  if ("idExterno" in item && item.idExterno) return String(item.idExterno);
  return `idx:${indice}`;
}

function alvo_de_evento(evento: EventoFinanceiroNormalizado, indice: number): AlvoSemantico {
  return {
    id: chave_item(evento, indice),
    contaId: evento.contaId,
    cartaoId: evento.cartaoId,
    tipo: evento.tipo,
    valor: evento.valor,
    data: evento.ocorridoEm,
    descricaoFonte: evento.descricaoFonte,
    favorecidoFonte: evento.favorecidoFonte,
    ocorridoEmInstante: evento.ocorridoEmInstante,
  };
}

/**
 * Entre itens iguais no mesmo HH:mm, o primeiro (já visto / mais antigo) fica
 * quieto; os extras são suspeitos. Sem relógio → ninguém é suspeito.
 */
export function ids_suspeitos_mesmo_minuto(itens: AlvoSemantico[]): string[] {
  const ordenados = [...itens].sort((a, b) => {
    const ignA = Boolean(a.ignoradoEmRelatorio);
    const ignB = Boolean(b.ignoradoEmRelatorio);
    if (ignA !== ignB) return ignA ? 1 : -1;
    const ta = a.dataCriacao ? new Date(a.dataCriacao).getTime() : 0;
    const tb = b.dataCriacao ? new Date(b.dataCriacao).getTime() : 0;
    if (ta !== tb) return ta - tb;
    return String(a.id ?? "").localeCompare(String(b.id ?? ""));
  });

  const vistos: AlvoSemantico[] = [];
  const suspeitos: string[] = [];
  for (const item of ordenados) {
    if (!item.id) {
      vistos.push(item);
      continue;
    }
    const par = vistos.find((ja) => casam_mesmo_minuto(item, ja));
    if (par) suspeitos.push(item.id);
    vistos.push(item);
  }
  return suspeitos;
}

/**
 * Não colapsa mais pelo dia. Grava todos; só sinaliza par com o mesmo HH:mm.
 */
export function colapsar_lote_semantico(
  eventos: EventoFinanceiroNormalizado[],
): { aceitos: EventoFinanceiroNormalizado[]; pulados: number; suspeitos: string[] } {
  const alvos = eventos.map((evento, indice) => alvo_de_evento(evento, indice));
  const suspeitos = ids_suspeitos_mesmo_minuto(alvos);
  return { aceitos: eventos, pulados: 0, suspeitos };
}

/**
 * idExterno novo sempre cria. O skip pelo dia comia Pix reais iguais
 * (quatro PROTECH de R$ 15.000 no mesmo dia). A pergunta fica no Extrato.
 */
export async function filtrar_criacao_semantica_of(
  eventos: EventoFinanceiroNormalizado[],
): Promise<{ aceitos: EventoFinanceiroNormalizado[]; pulados: number; suspeitos: string[] }> {
  return colapsar_lote_semantico(eventos);
}

/**
 * Depois de gravar, marca só os Fatos novos que caíram no mesmo minuto que
 * outro já existente (ou outro do próprio lote).
 */
export async function marcar_possiveis_repetidos_criados(
  movimentoIdsCriados: string[],
): Promise<number> {
  if (movimentoIdsCriados.length === 0) return 0;

  const banco = obter_banco();
  const criados = await banco
    .select({
      id: movimento.id,
      contaId: movimento.contaId,
      cartaoId: movimento.cartaoId,
      tipo: movimento.tipo,
      valor: movimento.valor,
      dataMovimento: movimento.dataMovimento,
      descricaoFonte: movimento.descricaoFonte,
      favorecidoFonte: movimento.favorecidoFonte,
      ocorridoEmInstante: movimento.ocorridoEmInstante,
      ignoradoEmRelatorio: movimento.ignoradoEmRelatorio,
      dataCriacao: movimento.dataCriacao,
    })
    .from(movimento)
    .where(inArray(movimento.id, movimentoIdsCriados));

  if (criados.length === 0) return 0;

  const contaIds = [
    ...new Set(criados.map((e) => e.contaId).filter((id): id is string => Boolean(id))),
  ];
  const cartaoIds = [
    ...new Set(criados.map((e) => e.cartaoId).filter((id): id is string => Boolean(id))),
  ];
  if (contaIds.length === 0 && cartaoIds.length === 0) return 0;

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
      ocorridoEmInstante: movimento.ocorridoEmInstante,
      ignoradoEmRelatorio: movimento.ignoradoEmRelatorio,
      dataCriacao: movimento.dataCriacao,
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

  const alvos: AlvoSemantico[] = existentes.map((ex) => ({
    id: ex.id,
    contaId: ex.contaId,
    cartaoId: ex.cartaoId,
    tipo: ex.tipo,
    valor: ex.valor,
    data: String(ex.dataMovimento),
    descricaoFonte: ex.descricaoFonte,
    favorecidoFonte: ex.favorecidoFonte,
    ocorridoEmInstante: ex.ocorridoEmInstante,
    ignoradoEmRelatorio: ex.ignoradoEmRelatorio,
    dataCriacao: ex.dataCriacao,
  }));

  const suspeitos = new Set(ids_suspeitos_mesmo_minuto(alvos));
  const marcar = movimentoIdsCriados.filter((id) => suspeitos.has(id));
  if (marcar.length === 0) return 0;

  await banco
    .update(movimento)
    .set({ possivelRepetido: true, dataAtualizacao: new Date() })
    .where(inArray(movimento.id, marcar));

  return marcar.length;
}
