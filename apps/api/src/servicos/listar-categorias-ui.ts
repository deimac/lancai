import { and, eq, gte, lte, ne } from "drizzle-orm";
import {
  cartao as cartaoTabela,
  categoria as categoriaTabela,
  eh_categoria_sistema,
  movimento as movimentoTabela,
  obter_banco,
} from "@lancai/banco";
import { hojeISO, mapa_fechamento_cartoes, movimento_no_resultado_do_mes, periodo_amplo_do_ciclo } from "@lancai/tipos";
import { gasto_do_orcamento, listar_status_orcamentos } from "./orcamento-servico";

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
  const mes = dataAtual.slice(0, 7);
  const amplo = periodo_amplo_do_ciclo({ de: inicio, ate: fim }, 1);
  const categorias = await banco
    .select()
    .from(categoriaTabela)
    .where(and(eq(categoriaTabela.usuarioId, usuarioId), eq(categoriaTabela.ativo, true)));

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
      })
      .from(movimentoTabela)
      .where(
        and(
          eq(movimentoTabela.usuarioId, usuarioId),
          gte(movimentoTabela.dataMovimento, amplo.de),
          lte(movimentoTabela.dataMovimento, amplo.ate),
          ne(movimentoTabela.status, "cancelado"),
        ),
      ),
    banco
      .select({ id: cartaoTabela.id, fechamento: cartaoTabela.fechamento })
      .from(cartaoTabela)
      .where(eq(cartaoTabela.usuarioId, usuarioId)),
  ]);

  const fechamentoPorCartao = mapa_fechamento_cartoes(cartoes);
  const noMes = movimentos.filter((movimento) =>
    movimento_no_resultado_do_mes(movimento, mes, fechamentoPorCartao),
  );

  const mapaTotais = new Map<string, { saidas: number; entradas: number; quantidade: number }>();
  for (const movimento of noMes) {
    if (!movimento.categoriaId) continue;
    const atual = mapaTotais.get(movimento.categoriaId) ?? {
      saidas: 0,
      entradas: 0,
      quantidade: 0,
    };
    const valor = Number(movimento.valor);
    const seguro = Number.isFinite(valor) ? valor : 0;
    if (movimento.tipo === "despesa" || movimento.tipo === "retirada" || movimento.tipo === "emprestimo") {
      atual.saidas += seguro;
    } else if (
      movimento.tipo === "receita" ||
      movimento.tipo === "reembolso" ||
      movimento.tipo === "estorno" ||
      movimento.tipo === "aporte"
    ) {
      atual.entradas += seguro;
    }
    atual.quantidade += 1;
    mapaTotais.set(movimento.categoriaId, atual);
  }

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
