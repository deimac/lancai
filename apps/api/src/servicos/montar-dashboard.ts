import { CATEGORIA_NAO_CLASSIFICADO } from "@lancai/banco";
import { mascara_final4_do_payload } from "@lancai/ia";
import {
  ModuloRelatorios,
  RepositorioRelatoriosDrizzle,
  inicioFimMesAtual,
} from "@lancai/relatorios";
import { hojeISO } from "@lancai/tipos";
import { mapear_origem_cartoes } from "./origem-conta-cartao";

const relatorios = new ModuloRelatorios(new RepositorioRelatoriosDrizzle());
const repositorio = new RepositorioRelatoriosDrizzle();

export interface DashboardCartao {
  id: string;
  nome: string;
  perfil: string;
  limite: number;
  comprometido: number;
  disponivel: number;
  fechamento: number;
  vencimento: number;
  sincronizada: boolean;
  instituicao: string | null;
  final4: string | null;
  gastoMes: number;
  quantidadeLancamentos: number;
}

export interface DashboardResposta {
  mes: string;
  periodo: { de: string; ate: string };
  resumo: {
    /** Soma dos saldos das contas do escopo (não inclui cartões). */
    saldoTotal: number;
    quantidadeContas: number;
    cartoesUsado: number;
    cartoesDisponivel: number;
    cartoesLimite: number;
    quantidadeCartoes: number;
    /** 0–100; null se não houver limite. */
    percentualUtilizadoCartoes: number | null;
    /** Soma das despesas em cartão no mês (competência). */
    gastoCartoesMes: number;
    quantidadeLancamentosCartoesMes: number;
    receitasMes: number;
    despesasMes: number;
    /** Receitas − despesas do mês. */
    resultadoMes: number;
    /** Usado no gráfico de fluxo; não é KPI da área superior. */
    saldoPeriodo: number;
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
  cartoes: DashboardCartao[];
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

  const [saldosVisao, categoriaVisao, historicoVisao, cartoesVisao, despesasCartaoMes, cartoesDb] =
    await Promise.all([
      relatorios.consultar_visao("saldos", { usuarioId }, dataAtual),
      relatorios.consultar_visao("categoria", filtros, dataAtual),
      relatorios.consultar_visao("historico", filtros, dataAtual),
      relatorios.consultar_visao("cartoes", { usuarioId }, dataAtual),
      repositorio.listarMovimentos(usuarioId, { periodo, tipos: ["despesa"] }),
      repositorio.listarCartoes(usuarioId),
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

  const gastoPorCartao = new Map<string, { gasto: number; quantidade: number }>();
  for (const movimento of despesasCartaoMes) {
    if (!movimento.cartaoId) continue;
    const atual = gastoPorCartao.get(movimento.cartaoId) ?? { gasto: 0, quantidade: 0 };
    atual.gasto += Number(movimento.valor);
    atual.quantidade += 1;
    gastoPorCartao.set(movimento.cartaoId, atual);
  }

  const idsCartoes = cartoes.cartoes.map((cartao) => cartao.id);
  const origens = await mapear_origem_cartoes(idsCartoes);
  const plasticoPorId = new Map(
    cartoesDb.map((cartao) => [cartao.id, cartao.dadosPlasticosCifrados] as const),
  );

  const cartoesDetalhe: DashboardCartao[] = cartoes.cartoes.map((cartao) => {
    const mes = gastoPorCartao.get(cartao.id) ?? { gasto: 0, quantidade: 0 };
    return {
      id: cartao.id,
      nome: cartao.nome,
      perfil: cartao.perfil,
      limite: cartao.limite,
      comprometido: cartao.comprometido,
      disponivel: cartao.disponivel,
      fechamento: cartao.fechamento,
      vencimento: cartao.vencimento,
      sincronizada: cartao.sincronizada,
      instituicao: origens.get(cartao.id)?.instituicao ?? null,
      final4: mascara_final4_do_payload(plasticoPorId.get(cartao.id)),
      gastoMes: arredondar(mes.gasto),
      quantidadeLancamentos: mes.quantidade,
    };
  });

  const cartoesUsado = arredondar(
    cartoesDetalhe.reduce((soma, cartao) => soma + cartao.comprometido, 0),
  );
  const cartoesDisponivel = arredondar(
    cartoesDetalhe.reduce((soma, cartao) => soma + cartao.disponivel, 0),
  );
  const cartoesLimite = arredondar(
    cartoesDetalhe.reduce((soma, cartao) => soma + cartao.limite, 0),
  );
  const percentualUtilizadoCartoes =
    cartoesLimite > 0
      ? Math.round((cartoesUsado / cartoesLimite) * 1000) / 10
      : null;
  const gastoCartoesMes = arredondar(
    cartoesDetalhe.reduce((soma, cartao) => soma + cartao.gastoMes, 0),
  );
  const quantidadeLancamentosCartoesMes = cartoesDetalhe.reduce(
    (soma, cartao) => soma + cartao.quantidadeLancamentos,
    0,
  );
  const resultadoMes = arredondar(categoria.totalReceitas - categoria.totalDespesas);

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
      quantidadeContas: saldos.contas.length,
      cartoesUsado,
      cartoesDisponivel,
      cartoesLimite,
      quantidadeCartoes: cartoesDetalhe.length,
      percentualUtilizadoCartoes,
      gastoCartoesMes,
      quantidadeLancamentosCartoesMes,
      receitasMes: categoria.totalReceitas,
      despesasMes: categoria.totalDespesas,
      resultadoMes,
      saldoPeriodo: historico.saldoPeriodo,
    },
    naoClassificado,
    gastosPorCategoria: categoria.ranking,
    fluxoSaldo,
    recentes,
    contas: saldos.contas,
    cartoes: cartoesDetalhe,
  };
}

function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
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
