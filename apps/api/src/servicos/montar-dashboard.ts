import { CATEGORIA_NAO_CLASSIFICADO } from "@lancai/banco";
import {
  ModuloRelatorios,
  RepositorioRelatoriosDrizzle,
  inicioFimMesAtual,
} from "@lancai/relatorios";
import { hojeISO } from "@lancai/tipos";

const relatorios = new ModuloRelatorios(new RepositorioRelatoriosDrizzle());
const repositorio = new RepositorioRelatoriosDrizzle();

export interface DashboardResposta {
  mes: string;
  periodo: { de: string; ate: string };
  resumo: {
    saldoTotal: number;
    receitasMes: number;
    despesasMes: number;
    saldoPeriodo: number;
    /** 0–100; null se não houve receita no mês. */
    taxaEconomia: number | null;
  };
  naoClassificado: {
    quantidade: number;
    total: number;
  };
  gastosPorCategoria: Array<{ categoriaNome: string; total: number }>;
  fluxoSaldo: Array<{ data: string; saldo: number }>;
  recentes: Array<{
    id: string;
    data: string;
    descricao: string;
    valor: number;
    tipo: string;
    categoriaNome: string | null;
    origemNome: string | null;
  }>;
  contas: Array<{ nome: string; perfil: string; saldoAtual: number }>;
  cartoes: Array<{
    nome: string;
    perfil: string;
    limite: number;
    comprometido: number;
    disponivel: number;
  }>;
}

/**
 * Agrega o cockpit a partir do ModuloRelatorios — o web só exibe.
 */
export async function montar_dashboard(
  usuarioId: string,
  dataAtual = hojeISO(),
): Promise<DashboardResposta> {
  const periodo = inicioFimMesAtual(dataAtual);
  const filtros = { usuarioId, periodo };

  const [saldosVisao, categoriaVisao, historicoVisao, cartoesVisao] = await Promise.all([
    relatorios.consultar_visao("saldos", { usuarioId }, dataAtual),
    relatorios.consultar_visao("categoria", filtros, dataAtual),
    relatorios.consultar_visao("historico", filtros, dataAtual),
    relatorios.consultar_visao("cartoes", { usuarioId }, dataAtual),
  ]);

  if (
    saldosVisao.tipo !== "saldos" ||
    categoriaVisao.tipo !== "categoria" ||
    historicoVisao.tipo !== "historico" ||
    cartoesVisao.tipo !== "cartoes"
  ) {
    throw new Error("Resposta inesperada do ModuloRelatorios no dashboard.");
  }

  const saldos = saldosVisao.dados;
  const categoria = categoriaVisao.dados;
  const historico = historicoVisao.dados;
  const cartoes = cartoesVisao.dados;

  const taxaEconomia =
    categoria.totalReceitas > 0
      ? Math.round(
          ((categoria.totalReceitas - categoria.totalDespesas) / categoria.totalReceitas) * 1000,
        ) / 10
      : null;

  const naoClassificado = await contar_nao_classificados(usuarioId, periodo);
  const fluxoSaldo = montar_fluxo_saldo(saldos.totalGeral, historico.saldoPeriodo, historico.dias);

  const recentes = historico.dias
    .flatMap((dia) =>
      dia.itens.map((item) => ({
        id: item.id,
        data: dia.data,
        descricao: item.descricao,
        valor: item.valor,
        tipo: item.tipo,
        categoriaNome: item.categoriaNome,
        origemNome: item.contaNome ?? (item.cartaoNome ? `Cartão ${item.cartaoNome}` : null),
      })),
    )
    .slice(0, 12);

  return {
    mes: dataAtual.slice(0, 7),
    periodo,
    resumo: {
      saldoTotal: saldos.totalGeral,
      receitasMes: categoria.totalReceitas,
      despesasMes: categoria.totalDespesas,
      saldoPeriodo: historico.saldoPeriodo,
      taxaEconomia,
    },
    naoClassificado,
    gastosPorCategoria: categoria.ranking,
    fluxoSaldo,
    recentes,
    contas: saldos.contas,
    cartoes: cartoes.cartoes.map((cartao) => ({
      nome: cartao.nome,
      perfil: cartao.perfil,
      limite: cartao.limite,
      comprometido: cartao.comprometido,
      disponivel: cartao.disponivel,
    })),
  };
}

async function contar_nao_classificados(
  usuarioId: string,
  periodo: { de: string; ate: string },
): Promise<{ quantidade: number; total: number }> {
  const categorias = await repositorio.listarCategorias(usuarioId);
  const categoria = categorias.find(
    (item: { id: string; nome: string }) =>
      item.nome.toLocaleLowerCase("pt-BR") ===
      CATEGORIA_NAO_CLASSIFICADO.toLocaleLowerCase("pt-BR"),
  );
  if (!categoria) return { quantidade: 0, total: 0 };

  const movimentos = await repositorio.listarMovimentos(usuarioId, {
    periodo,
    categoriaId: categoria.id,
    tipos: ["despesa", "receita"],
  });

  let total = 0;
  for (const movimento of movimentos) {
    total += Number(movimento.valor);
  }
  return { quantidade: movimentos.length, total };
}

function montar_fluxo_saldo(
  saldoAtual: number,
  saldoPeriodo: number,
  dias: Array<{
    data: string;
    itens: Array<{ tipo: string; valor: number }>;
  }>,
): Array<{ data: string; saldo: number }> {
  let saldo = saldoAtual - saldoPeriodo;
  const pontos: Array<{ data: string; saldo: number }> = [];

  for (const dia of [...dias].sort((a, b) => a.data.localeCompare(b.data))) {
    for (const item of dia.itens) {
      if (
        item.tipo === "receita" ||
        item.tipo === "reembolso" ||
        item.tipo === "estorno" ||
        item.tipo === "aporte"
      ) {
        saldo += item.valor;
      } else if (item.tipo === "despesa" || item.tipo === "retirada") {
        saldo -= item.valor;
      }
    }
    pontos.push({ data: dia.data, saldo: Math.round(saldo * 100) / 100 });
  }

  return pontos;
}
