import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import {
  categoria as categoriaTabela,
  eh_categoria_sistema,
  movimento as movimentoTabela,
  obter_banco,
} from "@lancai/banco";
import { hojeISO } from "@lancai/tipos";
import { gasto_do_orcamento, listar_status_orcamentos, SOMA_ENTRADAS, SOMA_SAIDAS } from "./orcamento-servico";

export type CategoriaUi = {
  id: string;
  nome: string;
  tipo: "receita" | "despesa" | "ambos";
  icone: string;
  cor: string;
  ativo: boolean;
  sistema: boolean;
  limite: number | null;
  gastoMes: number;
  percentual: number | null;
  movimentosMes: number;
};

function mes_iso(dataAtual: string): { inicio: string; fim: string } {
  const [ano, mes] = dataAtual.split("-");
  const inicio = `${ano}-${mes}-01`;
  const ultimoDia = new Date(Number(ano), Number(mes), 0).getDate();
  const fim = `${ano}-${mes}-${String(ultimoDia).padStart(2, "0")}`;
  return { inicio, fim };
}

export async function montar_categorias_ui(
  usuarioId: string,
  dataAtual = hojeISO(),
): Promise<CategoriaUi[]> {
  const banco = obter_banco();
  const { inicio, fim } = mes_iso(dataAtual);
  const categorias = await banco
    .select()
    .from(categoriaTabela)
    .where(and(eq(categoriaTabela.usuarioId, usuarioId), eq(categoriaTabela.ativo, true)));

  const totais = await banco
    .select({
      categoriaId: movimentoTabela.categoriaId,
      saidas: SOMA_SAIDAS,
      entradas: SOMA_ENTRADAS,
      quantidade: sql<number>`count(*)::int`,
    })
    .from(movimentoTabela)
    .where(
      and(
        eq(movimentoTabela.usuarioId, usuarioId),
        gte(movimentoTabela.dataMovimento, inicio),
        lte(movimentoTabela.dataMovimento, fim),
        ne(movimentoTabela.status, "cancelado"),
      ),
    )
    .groupBy(movimentoTabela.categoriaId);

  const mapaTotais = new Map(
    totais.map((linha) => [
      linha.categoriaId,
      {
        saidas: Number(linha.saidas),
        entradas: Number(linha.entradas),
        quantidade: Number(linha.quantidade),
      },
    ]),
  );

  let orcamentos: Awaited<ReturnType<typeof listar_status_orcamentos>> = [];
  try {
    orcamentos = await listar_status_orcamentos(usuarioId, dataAtual);
  } catch {
    orcamentos = [];
  }
  const mapaLimite = new Map(
    orcamentos
      .filter((item) => item.orcamento.categoriaId)
      .map((item) => [item.orcamento.categoriaId as string, item.limite]),
  );

  return categorias.map((categoria) => {
    const stats = mapaTotais.get(categoria.id) ?? { saidas: 0, entradas: 0, quantidade: 0 };
    const limite = mapaLimite.get(categoria.id) ?? null;
    const gastoMes = gasto_do_orcamento(categoria.tipo, stats.saidas, stats.entradas);
    return {
      id: categoria.id,
      nome: categoria.nome,
      tipo: categoria.tipo,
      icone: categoria.icone,
      cor: categoria.cor,
      ativo: categoria.ativo,
      sistema: eh_categoria_sistema(categoria.nome),
      limite,
      gastoMes,
      percentual: limite && limite > 0 ? (gastoMes / limite) * 100 : null,
      movimentosMes: stats.quantidade,
    };
  });
}
