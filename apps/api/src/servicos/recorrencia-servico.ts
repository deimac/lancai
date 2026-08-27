import { and, eq, gte, ilike, inArray, lte, ne, or } from "drizzle-orm";
import {
  cartao as cartaoTabela,
  conta as contaTabela,
  movimento as movimentoTabela,
  obter_banco,
  recorrencia as recorrenciaTabela,
  type Recorrencia,
} from "@lancai/banco";
import { MotorFinanceiro } from "@lancai/financeiro";
import {
  detectar_padroes_recorrentes,
  padrao_estavel_para_gerar,
  type PadraoRecorrente,
} from "@lancai/relatorios";
import {
  diferenca_em_centavos,
  formatarMoeda,
  hojeISO,
  normalizar_descricao_parcela,
} from "@lancai/tipos";
import { score_descricao_conciliacao } from "./conciliar-manual-com-fonte";
import { exigir_workspace_escrita, obter_escopo_leitura } from "./escopo-workspace";

const LIMIAR_EQUIVALENTE = 0.35;

/** Dias após o dia mediano para projetar padrão detectado (espera o OF rápido). */
export const CARENCIA_DIAS_DETECTADA = 3;

export type CandidatoCobrancaEquivalente = {
  descricao: string;
  descricaoFonte: string | null;
  favorecidoFonte?: string | null;
  valor: string | number;
  tipo: string;
  contaId: string | null;
  cartaoId: string | null;
  status: string;
  fonte: string;
};

export type OrigemRecorrencia = Recorrencia["origem"];

/** Já existe no mês um Fato (OF ou outro ativo) que casa com a recorrência cadastrada. */
export function ja_existe_cobranca_equivalente(entrada: {
  descricao: string;
  valor: number;
  tipo: string;
  contaId?: string | null;
  cartaoId?: string | null;
  movimentos: CandidatoCobrancaEquivalente[];
}): boolean {
  const contaId = entrada.contaId ?? null;
  const cartaoId = entrada.cartaoId ?? null;
  return entrada.movimentos.some((item) => {
    if (item.status === "cancelado") return false;
    if (item.fonte === "recorrencia") return false;
    if (item.tipo !== entrada.tipo) return false;
    if ((item.contaId ?? null) !== contaId || (item.cartaoId ?? null) !== cartaoId) return false;
    if (diferenca_em_centavos(item.valor, entrada.valor) > 1) return false;
    const score = score_descricao_conciliacao(
      entrada.descricao,
      item.descricaoFonte || item.descricao,
      item.favorecidoFonte,
    );
    return score >= LIMIAR_EQUIVALENTE;
  });
}

export function chave_identidade_recorrencia(entrada: {
  descricao: string;
  valor: number | string;
  contaId?: string | null;
  cartaoId?: string | null;
}): string {
  return [
    normalizar_descricao_parcela(entrada.descricao),
    String(Math.round(Number(entrada.valor))),
    entrada.cartaoId ?? "",
    entrada.contaId ?? "",
  ].join("|");
}

export function mesma_identidade_recorrencia(
  a: {
    descricao: string;
    valor: number | string;
    contaId?: string | null;
    cartaoId?: string | null;
  },
  b: {
    descricao: string;
    valor: number | string;
    contaId?: string | null;
    cartaoId?: string | null;
  },
): boolean {
  return chave_identidade_recorrencia(a) === chave_identidade_recorrencia(b);
}

export function data_liberacao_geracao(
  anoMes: string,
  diaDoMes: number,
  carenciaDias: number,
): string {
  const esperado = data_no_mes(anoMes, diaDoMes);
  if (carenciaDias <= 0) return esperado;
  const cursor = new Date(`${esperado}T12:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + carenciaDias);
  const bruto = cursor.toISOString().slice(0, 10);
  if (bruto.startsWith(`${anoMes}-`)) return bruto;
  return data_no_mes(anoMes, 31);
}

export function deve_gerar_recorrencia(entrada: {
  dataRef: string;
  diaDoMes: number;
  origem: OrigemRecorrencia;
  ultimaGeracao: string | null;
}): boolean {
  const mes = chave_mes(entrada.dataRef);
  if (entrada.ultimaGeracao === mes) return false;
  const carencia = entrada.origem === "detectada" ? CARENCIA_DIAS_DETECTADA : 0;
  return entrada.dataRef >= data_liberacao_geracao(mes, entrada.diaDoMes, carencia);
}

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
      workspaceId: await exigir_workspace_escrita(entrada.usuarioId),
      descricao: entrada.descricao.trim(),
      valor: entrada.valor.toFixed(2),
      tipo: entrada.tipo,
      categoriaId: entrada.categoriaId,
      contaId: entrada.contaId ?? null,
      cartaoId: entrada.cartaoId ?? null,
      diaDoMes: entrada.diaDoMes,
      origem: "cadastro",
      ativa: true,
    })
    .returning();
  if (!criada) throw new Error("Falha ao criar recorrência.");
  return criada;
}

export async function listar_recorrencias(
  usuarioId: string,
  opcoes: { incluirInativas?: boolean } = {},
): Promise<Recorrencia[]> {
  const escopo = await obter_escopo_leitura(usuarioId);
  if (escopo.workspaceIds.length === 0) return [];
  const banco = obter_banco();
  const condicoes = [
    eq(recorrenciaTabela.usuarioId, usuarioId),
    inArray(recorrenciaTabela.workspaceId, escopo.workspaceIds),
  ];
  if (!opcoes.incluirInativas) condicoes.push(eq(recorrenciaTabela.ativa, true));
  return banco.select().from(recorrenciaTabela).where(and(...condicoes));
}

export async function cancelar_recorrencia(usuarioId: string, descricao: string): Promise<Recorrencia | null> {
  const escopo = await obter_escopo_leitura(usuarioId);
  if (escopo.workspaceIds.length === 0) return null;
  const banco = obter_banco();
  const [encontrada] = await banco
    .select()
    .from(recorrenciaTabela)
    .where(
      and(
        eq(recorrenciaTabela.usuarioId, usuarioId),
        inArray(recorrenciaTabela.workspaceId, escopo.workspaceIds),
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

function grupo_movimentos_chave(usuarioId: string, workspaceId: string): string {
  return `${usuarioId}|${workspaceId}`;
}

/**
 * Materializa padrões estáveis (3+ meses) que ainda não têm linha em
 * `recorrencia`. Linha inativa (opt-out) conta como já conhecida.
 */
export async function materializar_padroes_detectados(
  dataRef = hojeISO(),
): Promise<{ criadas: number; puladas: number }> {
  const banco = obter_banco();
  const movimentos = await banco
    .select({
      usuarioId: movimentoTabela.usuarioId,
      workspaceId: movimentoTabela.workspaceId,
      descricao: movimentoTabela.descricao,
      valor: movimentoTabela.valor,
      dataMovimento: movimentoTabela.dataMovimento,
      tipo: movimentoTabela.tipo,
      status: movimentoTabela.status,
      cartaoId: movimentoTabela.cartaoId,
      contaId: movimentoTabela.contaId,
      parcelaTotal: movimentoTabela.parcelaTotal,
      parcelaCompraEm: movimentoTabela.parcelaCompraEm,
      categoriaId: movimentoTabela.categoriaId,
    })
    .from(movimentoTabela)
    .where(and(eq(movimentoTabela.tipo, "despesa"), ne(movimentoTabela.status, "cancelado")));

  const porDestino = new Map<string, typeof movimentos>();
  for (const movimento of movimentos) {
    const chave = grupo_movimentos_chave(movimento.usuarioId, movimento.workspaceId);
    const lista = porDestino.get(chave) ?? [];
    lista.push(movimento);
    porDestino.set(chave, lista);
  }

  const existentes = await banco.select().from(recorrenciaTabela);
  const conhecidas = new Set(
    existentes.map((item) =>
      [
        item.usuarioId,
        item.workspaceId,
        chave_identidade_recorrencia(item),
      ].join("|"),
    ),
  );

  let criadas = 0;
  let puladas = 0;

  for (const grupo of porDestino.values()) {
    const primeiro = grupo[0]!;
    const padroes = detectar_padroes_recorrentes(grupo, dataRef).filter(padrao_estavel_para_gerar);
    for (const padrao of padroes) {
      const identidade = [
        primeiro.usuarioId,
        primeiro.workspaceId,
        chave_identidade_recorrencia(padrao),
      ].join("|");
      if (conhecidas.has(identidade)) {
        puladas += 1;
        continue;
      }
      const [inserida] = await banco
        .insert(recorrenciaTabela)
        .values({
          usuarioId: primeiro.usuarioId,
          workspaceId: primeiro.workspaceId,
          descricao: padrao.descricao,
          valor: padrao.valor.toFixed(2),
          tipo: "despesa",
          categoriaId: padrao.categoriaId,
          contaId: padrao.contaId,
          cartaoId: padrao.cartaoId,
          diaDoMes: padrao.diaDoMes!,
          origem: "detectada",
          ativa: true,
        })
        .returning();
      if (!inserida) continue;
      conhecidas.add(identidade);
      criadas += 1;
    }
  }

  return { criadas, puladas };
}

/**
 * Gera movimentos do dia para recorrências ativas (idempotente por YYYY-MM).
 * Padrões detectados esperam carência; cadastro gera a partir do dia do mês.
 */
export async function gerar_recorrencias_do_dia(
  motor: MotorFinanceiro,
  dataRef = hojeISO(),
): Promise<{ gerados: number; pulados: number; materializadas: number }> {
  const materializacao = await materializar_padroes_detectados(dataRef);
  const banco = obter_banco();
  const mesChave = chave_mes(dataRef);

  const candidatas = await banco
    .select()
    .from(recorrenciaTabela)
    .where(eq(recorrenciaTabela.ativa, true));

  let gerados = 0;
  let pulados = 0;

  for (const item of candidatas) {
    if (item.ultimaGeracao === mesChave) {
      pulados += 1;
      continue;
    }
    if (
      !deve_gerar_recorrencia({
        dataRef,
        diaDoMes: item.diaDoMes,
        origem: item.origem,
        ultimaGeracao: null,
      })
    ) {
      continue;
    }
    if (!item.contaId && !item.cartaoId) {
      pulados += 1;
      continue;
    }

    const inicioMes = `${mesChave}-01`;
    const fimMes = data_no_mes(mesChave, 31);
    const origemCond =
      item.contaId && item.cartaoId
        ? or(
            eq(movimentoTabela.contaId, item.contaId),
            eq(movimentoTabela.cartaoId, item.cartaoId),
          )
        : item.contaId
          ? eq(movimentoTabela.contaId, item.contaId)
          : eq(movimentoTabela.cartaoId, item.cartaoId!);
    const existentes = await banco
      .select()
      .from(movimentoTabela)
      .where(
        and(
          eq(movimentoTabela.usuarioId, item.usuarioId),
          eq(movimentoTabela.workspaceId, item.workspaceId),
          ne(movimentoTabela.status, "cancelado"),
          gte(movimentoTabela.dataMovimento, inicioMes),
          lte(movimentoTabela.dataMovimento, fimMes),
          origemCond,
        ),
      );
    const tipoMovimento = item.tipo === "receita" ? "receita" : "despesa";
    if (
      ja_existe_cobranca_equivalente({
        descricao: item.descricao,
        valor: Number(item.valor),
        tipo: tipoMovimento,
        contaId: item.contaId,
        cartaoId: item.cartaoId,
        movimentos: existentes,
      })
    ) {
      await banco
        .update(recorrenciaTabela)
        .set({ ultimaGeracao: mesChave, dataAtualizacao: new Date() })
        .where(eq(recorrenciaTabela.id, item.id));
      pulados += 1;
      continue;
    }

    const tipoGasto = await perfil_do_destino(item.cartaoId, item.contaId);

    await motor.projetar_recorrencia({
      workspaceId: item.workspaceId,
      fonte: "recorrencia",
      descricao: item.descricao,
      valor: Number(item.valor),
      tipo: tipoMovimento,
      status: "previsto",
      tipoGasto,
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

  return { gerados, pulados, materializadas: materializacao.criadas };
}

async function perfil_do_destino(
  cartaoId: string | null,
  contaId: string | null,
): Promise<"pf" | "pj"> {
  const banco = obter_banco();
  if (cartaoId) {
    const [cartao] = await banco
      .select({ perfil: cartaoTabela.perfil })
      .from(cartaoTabela)
      .where(eq(cartaoTabela.id, cartaoId))
      .limit(1);
    if (cartao?.perfil === "pj") return "pj";
    if (cartao?.perfil === "pf") return "pf";
  }
  if (contaId) {
    const [conta] = await banco
      .select({ perfil: contaTabela.perfil })
      .from(contaTabela)
      .where(eq(contaTabela.id, contaId))
      .limit(1);
    if (conta?.perfil === "pj") return "pj";
  }
  return "pf";
}

/** Exposto para testes do filtro de opt-out no comprometimento. */
export function padrao_ja_conhecido(
  padrao: Pick<PadraoRecorrente, "descricao" | "valor" | "contaId" | "cartaoId">,
  recorrencias: Array<Pick<Recorrencia, "descricao" | "valor" | "contaId" | "cartaoId">>,
): boolean {
  return recorrencias.some((item) => mesma_identidade_recorrencia(padrao, item));
}
