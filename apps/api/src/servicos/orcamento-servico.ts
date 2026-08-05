import { and, eq, gte, lte, sql } from "drizzle-orm";
import {
  categoria as categoriaTabela,
  movimento as movimentoTabela,
  obter_banco,
  orcamento as orcamentoTabela,
  type Orcamento,
} from "@lancai/banco";
import { formatarMoeda } from "@lancai/tipos";

function mes_atual_iso(dataAtual: string): { inicio: string; fim: string; chave: string } {
  const [ano, mes] = dataAtual.split("-");
  const inicio = `${ano}-${mes}-01`;
  const ultimoDia = new Date(Number(ano), Number(mes), 0).getDate();
  const fim = `${ano}-${mes}-${String(ultimoDia).padStart(2, "0")}`;
  return { inicio, fim, chave: `${ano}-${mes}` };
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

export type StatusOrcamento = {
  orcamento: Orcamento;
  categoriaNome: string | null;
  gasto: number;
  limite: number;
  percentual: number;
};

async function somar_gastos(
  usuarioId: string,
  inicio: string,
  fim: string,
  categoriaId?: string | null,
): Promise<number> {
  const banco = obter_banco();
  const condicoes = [
    eq(movimentoTabela.usuarioId, usuarioId),
    eq(movimentoTabela.tipo, "despesa"),
    gte(movimentoTabela.dataMovimento, inicio),
    lte(movimentoTabela.dataMovimento, fim),
    sql`${movimentoTabela.status} <> 'cancelado'`,
  ];
  if (categoriaId) {
    condicoes.push(eq(movimentoTabela.categoriaId, categoriaId));
  }

  const [linha] = await banco
    .select({ total: sql<string>`coalesce(sum(${movimentoTabela.valor}), 0)` })
    .from(movimentoTabela)
    .where(and(...condicoes));

  return Number(linha?.total ?? 0);
}

export async function listar_status_orcamentos(
  usuarioId: string,
  dataAtual: string,
  categoriaId?: string | null,
): Promise<StatusOrcamento[]> {
  const banco = obter_banco();
  const { inicio, fim } = mes_atual_iso(dataAtual);

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
    if (orc.categoriaId) {
      const [cat] = await banco
        .select({ nome: categoriaTabela.nome })
        .from(categoriaTabela)
        .where(eq(categoriaTabela.id, orc.categoriaId))
        .limit(1);
      categoriaNome = cat?.nome ?? null;
    }
    const limite = Number(orc.valorLimite);
    const gasto = await somar_gastos(usuarioId, inicio, fim, orc.categoriaId);
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

/** Texto de alerta após lançamento (0 LLM). */
export async function texto_alerta_orcamento_apos_despesa(entrada: {
  usuarioId: string;
  dataAtual: string;
  categoriaId: string;
}): Promise<string | null> {
  const status = await listar_status_orcamentos(entrada.usuarioId, entrada.dataAtual);
  const relevantes = status.filter(
    (s) => !s.orcamento.categoriaId || s.orcamento.categoriaId === entrada.categoriaId,
  );
  const alertas: string[] = [];
  for (const item of relevantes) {
    if (item.percentual >= 100) {
      const rotulo = item.categoriaNome ?? "geral";
      alertas.push(
        `Atenção: orçamento ${rotulo} estourado (${Math.round(item.percentual)}% de ${formatarMoeda(item.limite)}).`,
      );
    } else if (item.percentual >= 80) {
      const rotulo = item.categoriaNome ?? "geral";
      alertas.push(
        `Alerta: orçamento ${rotulo} em ${Math.round(item.percentual)}% (${formatarMoeda(item.gasto)} de ${formatarMoeda(item.limite)}).`,
      );
    }
  }
  return alertas.length > 0 ? alertas.join(" ") : null;
}
