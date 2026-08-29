import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import {
  cartao as cartaoTabela,
  categoria as categoriaTabela,
  garantir_workspace_do_usuario,
  movimento as movimentoTabela,
  obter_banco,
  orcamento as orcamentoTabela,
  type Orcamento,
} from "@lancai/banco";
import {
  formatarMoeda,
  mapa_fechamento_cartoes,
  mapa_vencimento_cartoes,
  movimento_no_resultado_do_mes,
  periodo_amplo_do_ciclo,
  type Perfil,
} from "@lancai/tipos";

type TipoCategoria = "receita" | "despesa" | "ambos";

export function gasto_do_orcamento(
  tipoCategoria: TipoCategoria | null | undefined,
  saidas: number,
  entradas: number,
): number {
  const liquido = tipoCategoria === "ambos" ? saidas - entradas : saidas;
  return Math.round(liquido * 100) / 100;
}

function mes_atual_iso(dataAtual: string): { inicio: string; fim: string; chave: string } {
  const [ano, mes] = dataAtual.split("-");
  const inicio = `${ano}-${mes}-01`;
  const ultimoDia = new Date(Number(ano), Number(mes), 0).getDate();
  const fim = `${ano}-${mes}-${String(ultimoDia).padStart(2, "0")}`;
  return { inicio, fim, chave: `${ano}-${mes}` };
}

export type MovimentoGastoOrcamento = {
  dataMovimento: string;
  cartaoId?: string | null;
  categoriaId?: string | null;
  tipo: string;
  valor: string | number;
  tipoGasto: string;
  status: string;
  parcelaNumero?: number | null;
};

export function somar_gastos_dos_movimentos(
  movimentos: MovimentoGastoOrcamento[],
  opcoes: {
    mes: string;
    fechamentoPorCartao: ReadonlyMap<string, number>;
    vencimentoPorCartao?: ReadonlyMap<string, number>;
    categoriaId?: string | null;
    tipoGasto?: Perfil;
  },
): { saidas: number; entradas: number } {
  let saidas = 0;
  let entradas = 0;
  for (const movimento of movimentos) {
    if (movimento.status === "cancelado") continue;
    if (opcoes.categoriaId && movimento.categoriaId !== opcoes.categoriaId) continue;
    if (opcoes.tipoGasto && movimento.tipoGasto !== opcoes.tipoGasto) continue;
    if (
      !movimento_no_resultado_do_mes(
        movimento,
        opcoes.mes,
        opcoes.fechamentoPorCartao,
        opcoes.vencimentoPorCartao,
      )
    ) {
      continue;
    }
    const valor = Number(movimento.valor);
    if (!Number.isFinite(valor)) continue;
    if (movimento.tipo === "despesa" || movimento.tipo === "retirada" || movimento.tipo === "emprestimo") {
      saidas += valor;
    } else if (
      movimento.tipo === "receita" ||
      movimento.tipo === "reembolso" ||
      movimento.tipo === "estorno" ||
      movimento.tipo === "aporte"
    ) {
      entradas += valor;
    }
  }
  return {
    saidas: Math.round(saidas * 100) / 100,
    entradas: Math.round(entradas * 100) / 100,
  };
}

export async function definir_orcamento(entrada: {
  usuarioId: string;
  valorLimite: number;
  categoriaId?: string | null;
}): Promise<Orcamento> {
  const banco = obter_banco();
  const existentes = await banco
    .select()
    .from(orcamentoTabela)
    .where(
      and(
        eq(orcamentoTabela.usuarioId, entrada.usuarioId),
        eq(orcamentoTabela.ativo, true),
        entrada.categoriaId
          ? eq(orcamentoTabela.categoriaId, entrada.categoriaId)
          : sql`${orcamentoTabela.categoriaId} is null`,
      ),
    );

  for (const item of existentes) {
    await banco
      .update(orcamentoTabela)
      .set({ ativo: false, dataAtualizacao: new Date() })
      .where(eq(orcamentoTabela.id, item.id));
  }

  const [criado] = await banco
    .insert(orcamentoTabela)
    .values({
      usuarioId: entrada.usuarioId,
      workspaceId: await garantir_workspace_do_usuario(banco, entrada.usuarioId),
      categoriaId: entrada.categoriaId ?? null,
      valorLimite: entrada.valorLimite.toFixed(2),
      recorrenteMensal: true,
      mesReferencia: null,
      ativo: true,
    })
    .returning();

  if (!criado) throw new Error("Falha ao criar orçamento.");
  return criado;
}

export async function definir_limite_categoria(entrada: {
  usuarioId: string;
  categoriaId: string;
  valorLimite: number | null;
}): Promise<void> {
  if (entrada.valorLimite == null || entrada.valorLimite <= 0) {
    const banco = obter_banco();
    await banco
      .update(orcamentoTabela)
      .set({ ativo: false, dataAtualizacao: new Date() })
      .where(
        and(
          eq(orcamentoTabela.usuarioId, entrada.usuarioId),
          eq(orcamentoTabela.categoriaId, entrada.categoriaId),
          eq(orcamentoTabela.ativo, true),
        ),
      );
    return;
  }
  await definir_orcamento({
    usuarioId: entrada.usuarioId,
    categoriaId: entrada.categoriaId,
    valorLimite: entrada.valorLimite,
  });
}

export type StatusOrcamento = {
  orcamento: Orcamento;
  categoriaNome: string | null;
  gasto: number;
  limite: number;
  percentual: number;
};

async function carregar_movimentos_orcamento(
  usuarioId: string,
  dataAtual: string,
  tipoGasto?: Perfil,
): Promise<{
  mes: string;
  movimentos: MovimentoGastoOrcamento[];
  fechamentoPorCartao: Map<string, number>;
  vencimentoPorCartao: Map<string, number>;
}> {
  const banco = obter_banco();
  const { inicio, fim, chave } = mes_atual_iso(dataAtual);
  const amplo = periodo_amplo_do_ciclo({ de: inicio, ate: fim }, 1);
  const condicoes = [
    eq(movimentoTabela.usuarioId, usuarioId),
    gte(movimentoTabela.dataMovimento, amplo.de),
    lte(movimentoTabela.dataMovimento, amplo.ate),
    ne(movimentoTabela.status, "cancelado"),
  ];
  if (tipoGasto) {
    condicoes.push(eq(movimentoTabela.tipoGasto, tipoGasto));
  }
  const [movimentos, cartoes] = await Promise.all([
    banco
      .select({
        dataMovimento: movimentoTabela.dataMovimento,
        cartaoId: movimentoTabela.cartaoId,
        categoriaId: movimentoTabela.categoriaId,
        tipo: movimentoTabela.tipo,
        valor: movimentoTabela.valor,
        tipoGasto: movimentoTabela.tipoGasto,
        status: movimentoTabela.status,
        parcelaNumero: movimentoTabela.parcelaNumero,
      })
      .from(movimentoTabela)
      .where(and(...condicoes)),
    banco
      .select({ id: cartaoTabela.id, fechamento: cartaoTabela.fechamento, vencimento: cartaoTabela.vencimento })
      .from(cartaoTabela)
      .where(eq(cartaoTabela.usuarioId, usuarioId)),
  ]);
  return {
    mes: chave,
    movimentos,
    fechamentoPorCartao: mapa_fechamento_cartoes(cartoes),
    vencimentoPorCartao: mapa_vencimento_cartoes(cartoes),
  };
}

export async function listar_status_orcamentos(
  usuarioId: string,
  dataAtual: string,
  categoriaId?: string | null,
  tipoGasto?: Perfil,
): Promise<StatusOrcamento[]> {
  const banco = obter_banco();
  const { mes, movimentos, fechamentoPorCartao, vencimentoPorCartao } = await carregar_movimentos_orcamento(
    usuarioId,
    dataAtual,
    tipoGasto,
  );

  const orcamentos = await banco
    .select()
    .from(orcamentoTabela)
    .where(and(eq(orcamentoTabela.usuarioId, usuarioId), eq(orcamentoTabela.ativo, true)));

  const filtrados = categoriaId
    ? orcamentos.filter((o) => o.categoriaId === categoriaId)
    : orcamentos;

  const status: StatusOrcamento[] = [];
  for (const orc of filtrados) {
    let categoriaNome: string | null = null;
    let tipoCategoria: TipoCategoria | null = null;
    if (orc.categoriaId) {
      const [cat] = await banco
        .select({ nome: categoriaTabela.nome, tipo: categoriaTabela.tipo })
        .from(categoriaTabela)
        .where(eq(categoriaTabela.id, orc.categoriaId))
        .limit(1);
      categoriaNome = cat?.nome ?? null;
      tipoCategoria = cat?.tipo ?? null;
    }
    const limite = Number(orc.valorLimite);
    const totais = somar_gastos_dos_movimentos(movimentos, {
      mes,
      fechamentoPorCartao,
      vencimentoPorCartao,
      categoriaId: orc.categoriaId,
    });
    const gasto = gasto_do_orcamento(tipoCategoria, totais.saidas, totais.entradas);
    const percentual = limite > 0 ? (gasto / limite) * 100 : 0;
    status.push({ orcamento: orc, categoriaNome, gasto, limite, percentual });
  }
  return status;
}

export function formatar_status_orcamentos(lista: StatusOrcamento[]): string {
  if (lista.length === 0) {
    return 'Você ainda não tem orçamento. Ex.: "orçamento de alimentação 800".';
  }
  const linhas = lista.map((item) => {
    const rotulo = item.categoriaNome ? item.categoriaNome : "geral";
    const pct = Math.round(item.percentual);
    return `• ${rotulo}: ${formatarMoeda(item.gasto)} de ${formatarMoeda(item.limite)} (${pct}%)`;
  });
  return `Orçamento deste mês:\n${linhas.join("\n")}`;
}

export type AlertaOrcamento = {
  orcamentoId: string;
  faixa: 80 | 100;
  texto: string;
};

/** Deriva alertas 80%/100% a partir do status — compartilhado chat e Open Finance. */
export function alertas_de_status_orcamento(status: StatusOrcamento[]): AlertaOrcamento[] {
  const alertas: AlertaOrcamento[] = [];
  for (const item of status) {
    const rotulo = item.categoriaNome ?? "geral";
    if (item.percentual >= 100) {
      alertas.push({
        orcamentoId: item.orcamento.id,
        faixa: 100,
        texto: `Atenção: orçamento ${rotulo} estourado (${Math.round(item.percentual)}% de ${formatarMoeda(item.limite)}).`,
      });
    } else if (item.percentual >= 80) {
      alertas.push({
        orcamentoId: item.orcamento.id,
        faixa: 80,
        texto: `Alerta: orçamento ${rotulo} em ${Math.round(item.percentual)}% (${formatarMoeda(item.gasto)} de ${formatarMoeda(item.limite)}).`,
      });
    }
  }
  return alertas;
}

/** Texto de alerta após lançamento (0 LLM). */
export async function texto_alerta_orcamento_apos_despesa(entrada: {
  usuarioId: string;
  dataAtual: string;
  categoriaId: string;
}): Promise<string | null> {
  try {
    const status = await listar_status_orcamentos(entrada.usuarioId, entrada.dataAtual);
    const relevantes = status.filter(
      (s) => !s.orcamento.categoriaId || s.orcamento.categoriaId === entrada.categoriaId,
    );
    const alertas = alertas_de_status_orcamento(relevantes);
    return alertas.length > 0 ? alertas.map((a) => a.texto).join(" ") : null;
  } catch (erro) {
    // Migration 0006 ainda não aplicada — não derruba o lançamento.
    const msg = erro instanceof Error ? erro.message : String(erro);
    if (/orcamento|recorrencia|does not exist|42P01/i.test(msg)) {
      console.warn(`[orcamento] alerta ignorado (tabela ausente?): ${msg.slice(0, 120)}`);
      return null;
    }
    throw erro;
  }
}
