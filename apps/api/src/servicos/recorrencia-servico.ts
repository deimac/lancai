import { and, eq, ilike } from "drizzle-orm";
import {
  obter_banco,
  recorrencia as recorrenciaTabela,
  type Recorrencia,
} from "@lancai/banco";
import { MotorFinanceiro } from "@lancai/financeiro";
import { formatarMoeda, hojeISO } from "@lancai/tipos";

export async function criar_recorrencia(entrada: {
  usuarioId: string;
  descricao: string;
  valor: number;
  diaDoMes: number;
  tipo: "despesa" | "receita";
  categoriaId: string;
  contaId?: string | null;
  cartaoId?: string | null;
}): Promise<Recorrencia> {
  if (!entrada.contaId && !entrada.cartaoId) {
    throw new Error("Recorrência exige conta ou cartão.");
  }
  const banco = obter_banco();
  const [criada] = await banco
    .insert(recorrenciaTabela)
    .values({
      usuarioId: entrada.usuarioId,
      descricao: entrada.descricao.trim(),
      valor: entrada.valor.toFixed(2),
      tipo: entrada.tipo,
      categoriaId: entrada.categoriaId,
      contaId: entrada.contaId ?? null,
      cartaoId: entrada.cartaoId ?? null,
      diaDoMes: entrada.diaDoMes,
      ativa: true,
    })
    .returning();
  if (!criada) throw new Error("Falha ao criar recorrência.");
  return criada;
}

export async function listar_recorrencias(usuarioId: string): Promise<Recorrencia[]> {
  const banco = obter_banco();
  return banco
    .select()
    .from(recorrenciaTabela)
    .where(and(eq(recorrenciaTabela.usuarioId, usuarioId), eq(recorrenciaTabela.ativa, true)));
}

export async function cancelar_recorrencia(usuarioId: string, descricao: string): Promise<Recorrencia | null> {
  const banco = obter_banco();
  const [encontrada] = await banco
    .select()
    .from(recorrenciaTabela)
    .where(
      and(
        eq(recorrenciaTabela.usuarioId, usuarioId),
        eq(recorrenciaTabela.ativa, true),
        ilike(recorrenciaTabela.descricao, `%${descricao.trim()}%`),
      ),
    )
    .limit(1);

  if (!encontrada) return null;

  const [atualizada] = await banco
    .update(recorrenciaTabela)
    .set({ ativa: false, dataAtualizacao: new Date() })
    .where(eq(recorrenciaTabela.id, encontrada.id))
    .returning();

  return atualizada ?? null;
}

export function formatar_lista_recorrencias(lista: Recorrencia[]): string {
  if (lista.length === 0) {
    return 'Nenhuma recorrência ativa. Ex.: "todo mês dia 10 Netflix 55 na Nubank".';
  }
  const linhas = lista.map(
    (r) => `• ${r.descricao}: ${formatarMoeda(r.valor)} todo dia ${r.diaDoMes}`,
  );
  return `Recorrências ativas:\n${linhas.join("\n")}`;
}

function chave_mes(dataISO: string): string {
  return dataISO.slice(0, 7);
}

function data_no_mes(anoMes: string, dia: number): string {
  const [ano, mes] = anoMes.split("-").map(Number);
  const ultimo = new Date(ano!, mes!, 0).getDate();
  const diaOk = Math.min(Math.max(1, dia), ultimo);
  return `${anoMes}-${String(diaOk).padStart(2, "0")}`;
}

/**
 * Gera movimentos do dia para recorrências ativas (idempotente por YYYY-MM).
 */
export async function gerar_recorrencias_do_dia(
  motor: MotorFinanceiro,
  dataRef = hojeISO(),
): Promise<{ gerados: number; pulados: number }> {
  const banco = obter_banco();
  const dia = Number(dataRef.slice(8, 10));
  const mesChave = chave_mes(dataRef);

  const candidatas = await banco
    .select()
    .from(recorrenciaTabela)
    .where(and(eq(recorrenciaTabela.ativa, true), eq(recorrenciaTabela.diaDoMes, dia)));

  let gerados = 0;
  let pulados = 0;

  for (const item of candidatas) {
    if (item.ultimaGeracao === mesChave) {
      pulados += 1;
      continue;
    }
    if (!item.contaId && !item.cartaoId) {
      pulados += 1;
      continue;
    }

    await motor.criar_movimento({
      descricao: item.descricao,
      valor: Number(item.valor),
      tipo: item.tipo === "receita" ? "receita" : "despesa",
      status: "realizado",
      perfil: "pf",
      dataMovimento: data_no_mes(mesChave, item.diaDoMes),
      contaId: item.contaId ?? undefined,
      cartaoId: item.cartaoId ?? undefined,
      categoriaId: item.categoriaId,
      usuarioId: item.usuarioId,
      criadoPor: item.usuarioId,
    });

    await banco
      .update(recorrenciaTabela)
      .set({ ultimaGeracao: mesChave, dataAtualizacao: new Date() })
      .where(eq(recorrenciaTabela.id, item.id));

    gerados += 1;
  }

  return { gerados, pulados };
}
