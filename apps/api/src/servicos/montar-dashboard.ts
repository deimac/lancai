import { CATEGORIA_NAO_CLASSIFICADO } from "@lancai/banco";
import { mascara_final4_do_payload } from "@lancai/ia";
import {
  ModuloRelatorios,
  RepositorioRelatoriosDrizzle,
  inicioFimMesAtual,
} from "@lancai/relatorios";
import { adicionarMeses, deISOParaData, eh_movimento_parcelado, hojeISO, paraDataISO } from "@lancai/tipos";
import { mapear_origem_cartoes } from "./origem-conta-cartao";
import { listar_status_orcamentos } from "./orcamento-servico";

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

export interface RankingCategoria {
  categoriaNome: string;
  total: number;
  icone: string;
  cor: string;
}

export interface ProximoPagamento {
  id: string;
  data: string;
  descricao: string;
  valor: number;
  origem: "previsto" | "parcela" | "fatura" | "recorrente";
  contaNome: string | null;
  vencida: boolean;
  /** Fatura com Pix/TED ligado ao cartão e ao mês de vencimento. */
  pago: boolean;
}

export interface OrcamentoDashboard {
  categoriaNome: string | null;
  gasto: number;
  limite: number;
  percentual: number;
  icone: string;
  cor: string;
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
    variacaoReceitas: number | null;
    variacaoDespesas: number | null;
    variacaoResultado: number | null;
  };
  naoClassificado: {
    quantidade: number;
    total: number;
  };
  gastosPorCategoria: RankingCategoria[];
  receitasPorCategoria: RankingCategoria[];
  fluxoSaldo: Array<{ data: string; saldo: number }>;
  fluxoResultado: Array<{
    data: string;
    entradas: number;
    saidas: number;
    resultado: number;
    resultadoAcumulado: number;
  }>;
  recentes: Array<{
    id: string;
    data: string;
    descricao: string;
    valor: number;
    tipo: string;
    categoriaNome: string | null;
    origemNome: string | null;
  }>;
  proximosPagamentos: ProximoPagamento[];
  orcamentos: OrcamentoDashboard[];
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
  const dataAnterior = paraDataISO(adicionarMeses(deISOParaData(periodo.de), -1));
  const periodoAnterior = inicioFimMesAtual(dataAnterior);

  const [
    saldosVisao,
    categoriaVisao,
    historicoVisao,
    cartoesVisao,
    despesasCartaoMes,
    cartoesDb,
    categoriaAnteriorVisao,
    futuroVisao,
    movimentosMes,
    categoriasDb,
    movimentosQuitadas,
  ] =
    await Promise.all([
      relatorios.consultar_visao("saldos", { usuarioId }, dataAtual),
      relatorios.consultar_visao("categoria", filtros, dataAtual),
      relatorios.consultar_visao("historico", filtros, dataAtual),
      relatorios.consultar_visao("cartoes", { usuarioId }, dataAtual),
      repositorio.listarMovimentos(usuarioId, { periodo, tipos: ["despesa"] }),
      repositorio.listarCartoes(usuarioId),
      relatorios.consultar_visao("categoria", { usuarioId, periodo: periodoAnterior }, dataAnterior),
      relatorios.consultar_visao("futuro", { usuarioId, periodo }, dataAtual),
      repositorio.listarMovimentos(usuarioId, { periodo }),
      repositorio.listarCategorias(usuarioId),
      repositorio.listarMovimentos(usuarioId, {
        periodo: {
          de: inicioFimMesAtual(paraDataISO(adicionarMeses(deISOParaData(periodo.de), -1))).de,
          ate: inicioFimMesAtual(paraDataISO(adicionarMeses(deISOParaData(periodo.de), 1))).ate,
        },
        incluirIgnorados: true,
      }),
    ]);

  if (
    saldosVisao.tipo !== "saldos" ||
    categoriaVisao.tipo !== "categoria" ||
    historicoVisao.tipo !== "historico" ||
    cartoesVisao.tipo !== "cartoes" ||
    categoriaAnteriorVisao.tipo !== "categoria" ||
    futuroVisao.tipo !== "futuro"
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
  const fluxoResultado = montar_fluxo_resultado(movimentosMes, periodo);
  const visualPorNome = new Map(
    categoriasDb.map((item) => [item.nome, { icone: item.icone, cor: item.cor }] as const),
  );
  const gastosPorCategoria = montar_ranking_tipo(movimentosMes, categoriasDb, "despesa");
  const receitasPorCategoria = montar_ranking_tipo(movimentosMes, categoriasDb, "receita");
  const resultadoAnterior = arredondar(
    categoriaAnteriorVisao.dados.totalReceitas - categoriaAnteriorVisao.dados.totalDespesas,
  );

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

  let orcamentos: OrcamentoDashboard[] = [];
  try {
    const status = await listar_status_orcamentos(usuarioId, dataAtual);
    orcamentos = status.map((item) => ({
      categoriaNome: item.categoriaNome,
      gasto: item.gasto,
      limite: item.limite,
      percentual: item.percentual,
      icone: item.categoriaNome
        ? (visualPorNome.get(item.categoriaNome)?.icone ?? "geral")
        : "geral",
      cor: item.categoriaNome
        ? (visualPorNome.get(item.categoriaNome)?.cor ?? "neutro")
        : "neutro",
    }));
  } catch {
    orcamentos = [];
  }

  const proximosPagamentos = montar_proximos_pagamentos({
    futuro: futuroVisao.dados.itens,
    cartoes: cartoesDetalhe,
    movimentos: movimentosMes,
    pagamentosFatura: movimentosQuitadas,
    // O web manda o dia 1 do mês selecionado; vencido/em aberto compara com hoje de verdade.
    hoje: hojeISO(),
    periodo,
  });

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
      variacaoReceitas: variacao_percentual(
        categoria.totalReceitas,
        categoriaAnteriorVisao.dados.totalReceitas,
      ),
      variacaoDespesas: variacao_percentual(
        categoria.totalDespesas,
        categoriaAnteriorVisao.dados.totalDespesas,
      ),
      variacaoResultado: variacao_percentual(resultadoMes, resultadoAnterior),
    },
    naoClassificado,
    gastosPorCategoria,
    receitasPorCategoria,
    fluxoSaldo,
    fluxoResultado,
    recentes,
    proximosPagamentos,
    orcamentos,
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

function variacao_percentual(atual: number, anterior: number): number | null {
  if (anterior === 0) return atual === 0 ? 0 : null;
  return Math.round(((atual - anterior) / Math.abs(anterior)) * 1000) / 10;
}

function montar_ranking_tipo(
  movimentos: Array<{ tipo: string; valor: string | number; categoriaId: string | null }>,
  categorias: Array<{ id: string; nome: string; icone: string; cor: string }>,
  tipo: "receita" | "despesa",
): RankingCategoria[] {
  const mapa = new Map(categorias.map((item) => [item.id, item]));
  const totais = new Map<string, RankingCategoria>();
  for (const movimento of movimentos) {
    if (movimento.tipo !== tipo) continue;
    const cat = movimento.categoriaId ? mapa.get(movimento.categoriaId) : undefined;
    const nome = cat?.nome ?? "Sem categoria";
    const atual = totais.get(nome) ?? {
      categoriaNome: nome,
      total: 0,
      icone: cat?.icone ?? "geral",
      cor: cat?.cor ?? "neutro",
    };
    atual.total += Number(movimento.valor);
    totais.set(nome, atual);
  }
  return [...totais.values()]
    .map((item) => ({ ...item, total: arredondar(item.total) }))
    .sort((a, b) => b.total - a.total);
}

function montar_fluxo_resultado(
  movimentos: Array<{ dataMovimento: string; tipo: string; valor: string | number }>,
  periodo: { de: string; ate: string },
): Array<{
  data: string;
  entradas: number;
  saidas: number;
  resultado: number;
  resultadoAcumulado: number;
}> {
  const porDia = new Map<string, { entradas: number; saidas: number }>();
  for (const movimento of movimentos) {
    const dia = String(movimento.dataMovimento).slice(0, 10);
    const atual = porDia.get(dia) ?? { entradas: 0, saidas: 0 };
    const valor = Number(movimento.valor);
    if (["receita", "reembolso", "estorno", "aporte"].includes(movimento.tipo)) {
      atual.entradas += valor;
    } else if (movimento.tipo === "despesa" || movimento.tipo === "retirada") {
      atual.saidas += valor;
    }
    porDia.set(dia, atual);
  }

  const pontos: Array<{
    data: string;
    entradas: number;
    saidas: number;
    resultado: number;
    resultadoAcumulado: number;
  }> = [];
  const inicio = deISOParaData(periodo.de);
  const fim = deISOParaData(periodo.ate);
  let acumulado = 0;
  for (let cursor = new Date(inicio); cursor.getTime() <= fim.getTime(); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const data = paraDataISO(cursor);
    const dia = porDia.get(data) ?? { entradas: 0, saidas: 0 };
    const resultado = arredondar(dia.entradas - dia.saidas);
    acumulado = arredondar(acumulado + resultado);
    pontos.push({
      data,
      entradas: arredondar(dia.entradas),
      saidas: arredondar(dia.saidas),
      resultado,
      resultadoAcumulado: acumulado,
    });
  }
  return pontos;
}

export function montar_proximos_pagamentos(entrada: {
  futuro: Array<{ descricao: string; valor: number; data: string; origem: "parcela" | "movimento" }>;
  cartoes: DashboardCartao[];
  movimentos: Array<{
    id: string;
    descricao: string;
    valor: string | number;
    status: string;
    dataMovimento: string;
    fonte: string;
    tipo: string;
    cartaoId?: string | null;
    parcelaTotal?: number | null;
    parcelaCompraEm?: string | Date | null;
  }>;
  pagamentosFatura?: Array<{
    status: string;
    papel?: string | null;
    cartaoFaturaId?: string | null;
    competenciaFatura?: string | null;
  }>;
  hoje: string;
  periodo: { de: string; ate: string };
}): ProximoPagamento[] {
  const itens: ProximoPagamento[] = [];
  const mesAgenda = entrada.periodo.de.slice(0, 7);
  const faturasQuitadas = new Set<string>();
  for (const movimento of entrada.pagamentosFatura ?? []) {
    if (movimento.status === "cancelado") continue;
    if (movimento.papel !== "pagamento_fatura") continue;
    if (!movimento.cartaoFaturaId || !movimento.competenciaFatura) continue;
    faturasQuitadas.add(`${movimento.cartaoFaturaId}|${movimento.competenciaFatura}`);
  }

  for (const item of entrada.futuro) {
    itens.push({
      id: `${item.origem}-${item.data}-${item.descricao}`,
      data: item.data,
      descricao: item.descricao,
      valor: item.valor,
      origem: item.origem === "parcela" ? "parcela" : "previsto",
      contaNome: null,
      vencida: item.data < entrada.hoje,
      pago: false,
    });
  }

  for (const movimento of entrada.movimentos) {
    if (movimento.status !== "previsto") continue;
    if (movimento.tipo !== "despesa" && movimento.tipo !== "retirada") continue;
    if (eh_movimento_parcelado(movimento)) continue;
    itens.push({
      id: movimento.id,
      data: String(movimento.dataMovimento).slice(0, 10),
      descricao: movimento.descricao,
      valor: Number(movimento.valor),
      origem: movimento.fonte === "recorrencia" ? "recorrente" : "previsto",
      contaNome: null,
      vencida: String(movimento.dataMovimento).slice(0, 10) < entrada.hoje,
      pago: false,
    });
  }

  for (const cartao of entrada.cartoes) {
    const dia = String(cartao.vencimento).padStart(2, "0");
    const data = `${mesAgenda}-${dia}`;
    const pago = faturasQuitadas.has(`${cartao.id}|${mesAgenda}`);
    itens.push({
      id: `fatura-${cartao.id}`,
      data,
      descricao: `Fatura ${cartao.nome}`,
      valor: cartao.gastoMes,
      origem: "fatura",
      contaNome: cartao.nome,
      vencida: !pago && data < entrada.hoje,
      pago,
    });
  }

  const vistos = new Set<string>();
  return itens
    .filter((item) => {
      const chave = `${item.descricao}|${item.data}|${item.valor}`;
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    })
    .sort((a, b) => {
      if (a.pago !== b.pago) return Number(a.pago) - Number(b.pago);
      if (a.vencida !== b.vencida) return Number(b.vencida) - Number(a.vencida);
      return a.data.localeCompare(b.data) || a.descricao.localeCompare(b.descricao, "pt-BR");
    })
    .slice(0, 16);
}
