import { CATEGORIA_NAO_CLASSIFICADO } from "@lancai/banco";
import { mascara_final4_do_payload } from "@lancai/ia";
import {
  ModuloRelatorios,
  RepositorioRelatoriosDrizzle,
  inicioFimMesAtual,
} from "@lancai/relatorios";
import {
  adicionarMeses,
  aplicar_total_oficial,
  competencia_ciclo_da_data,
  competencia_quitacao_fatura,
  data_vencimento_do_ciclo,
  intervalo_ciclo_fatura,
  mes_gasto_do_cartao,
  deISOParaData,
  eh_credito_quitacao_no_cartao,
  eh_linha_da_fatura,
  valor_na_fatura,
  eh_movimento_parcelado,
  hojeISO,
  mapa_fechamento_cartoes,
  mapa_vencimento_cartoes,
  movimento_no_resultado_do_mes,
  pagamentos_ciclo_de,
  type PagamentoCiclo,
  paraDataISO,
  periodo_amplo_do_ciclo,
  type Perfil,
} from "@lancai/tipos";
import { obter_escopo_leitura } from "./escopo-workspace";
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
  /** True no mês civil atual: o número é a fatura em aberto daquele cartão. */
  gastoEhFaturaAtual?: boolean;
  /** Competência do ciclo somado neste recorte. */
  competenciaCiclo?: string;
  cicloInicio?: string;
  cicloFim?: string;
  /** Total que o banco publicou para este ciclo. Ausente na fatura aberta. */
  totalOficial?: number | null;
  /** Oficial − soma líquida das linhas. Null se não há total do banco. */
  ajusteFatura?: number | null;
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
  /** Fatura com crédito de quitação no cartão no mês. */
  pago: boolean;
  /** Dia em que o crédito entrou no cartão; só em fatura paga. */
  dataPagamento?: string | null;
  /** Competência do ciclo (mês do fechamento), para o título Fatura ago / jul. */
  competenciaCiclo?: string | null;
  /** Em aberto até o fecha; a pagar depois do fecha; paga no mês do Pix. */
  situacao?: "aberta" | "a_pagar" | "paga" | "vencida";
}

export interface OrcamentoDashboard {
  categoriaNome: string | null;
  gasto: number;
  limite: number;
  percentual: number;
  icone: string;
  cor: string;
}

export interface TotaisNaturezaDashboard {
  receitas: number;
  despesas: number;
  resultado: number;
}

export interface CruzamentoDashboard {
  totalPessoalComEmpresa: number;
  totalEmpresaComPessoal: number;
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
  /** Natureza aplicada ao P&L/categorias; null = todos. */
  tipoGasto: Perfil | null;
  /** Totais do mês por natureza, sempre os dois lados — para o subtítulo em Todos. */
  natureza: {
    pessoal: TotaisNaturezaDashboard;
    empresa: TotaisNaturezaDashboard;
  };
  /**
   * Cruzamento origem ≠ natureza. `null` na visão Geral (KPI de workspace/conta).
   */
  cruzamento: CruzamentoDashboard | null;
  naoClassificado: {
    quantidade: number;
    total: number;
  };
  gastosPorCategoria: RankingCategoria[];
  receitasPorCategoria: RankingCategoria[];
  /** Saldo das contas ao fim de cada dia (caixa), não o resultado P&L. */
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
    icone: string;
    cor: string;
  }>;
  proximosPagamentos: ProximoPagamento[];
  orcamentos: OrcamentoDashboard[];
  contas: Array<{ nome: string; perfil: string; saldoAtual: number }>;
  cartoes: DashboardCartao[];
}

/**
 * `pessoal`/`empresa` na query do Cockpit viram `pf`/`pj`. Qualquer outro valor = todos.
 */
export function perfil_de_tipo_gasto_dashboard(valor?: string): Perfil | undefined {
  if (valor === "pf" || valor === "pessoal") return "pf";
  if (valor === "pj" || valor === "empresa") return "pj";
  return undefined;
}

function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
}

export function filtrar_movimentos_por_natureza<T extends { tipoGasto: string }>(
  movimentos: T[],
  perfil?: Perfil,
): T[] {
  if (!perfil) return movimentos;
  return movimentos.filter((movimento) => movimento.tipoGasto === perfil);
}

export function agregar_totais_por_natureza(
  movimentos: Array<{ tipo: string; valor: string | number; tipoGasto: string }>,
): { pessoal: TotaisNaturezaDashboard; empresa: TotaisNaturezaDashboard } {
  const pessoal = { receitas: 0, despesas: 0 };
  const empresa = { receitas: 0, despesas: 0 };
  for (const movimento of movimentos) {
    if (movimento.tipo !== "receita" && movimento.tipo !== "despesa") continue;
    const alvo = movimento.tipoGasto === "pj" ? empresa : pessoal;
    if (movimento.tipo === "receita") alvo.receitas += Number(movimento.valor);
    else alvo.despesas += Number(movimento.valor);
  }
  const fechar = (item: { receitas: number; despesas: number }): TotaisNaturezaDashboard => {
    const receitas = arredondar(item.receitas);
    const despesas = arredondar(item.despesas);
    return { receitas, despesas, resultado: arredondar(receitas - despesas) };
  };
  return { pessoal: fechar(pessoal), empresa: fechar(empresa) };
}

export function somar_receitas_despesas(
  movimentos: Array<{ tipo: string; valor: string | number; papel?: string | null }>,
): { receitas: number; despesas: number } {
  let receitas = 0;
  let despesas = 0;
  for (const movimento of movimentos) {
    if (movimento.papel === "pagamento_fatura") continue;
    if (movimento.tipo === "receita") receitas += Number(movimento.valor);
    else if (movimento.tipo === "despesa") despesas += Number(movimento.valor);
  }
  return { receitas: arredondar(receitas), despesas: arredondar(despesas) };
}

export { mes_gasto_do_cartao } from "@lancai/tipos";

export function filtrar_movimentos_do_resultado<
  T extends {
    dataMovimento: string;
    cartaoId?: string | null;
    parcelaNumero?: number | null;
    status?: string | null;
  },
>(
  movimentos: T[],
  mesPorCartao: ReadonlyMap<string, string>,
  mesConta: string,
  fechamentoPorCartao: ReadonlyMap<string, number>,
  vencimentoPorCartao: ReadonlyMap<string, number> = new Map(),
  pagamentos: PagamentoCiclo[] = [],
): T[] {
  return movimentos.filter((movimento) => {
    const alvo = movimento.cartaoId
      ? (mesPorCartao.get(movimento.cartaoId) ?? mesConta)
      : mesConta;
    return movimento_no_resultado_do_mes(
      movimento,
      alvo,
      fechamentoPorCartao,
      vencimentoPorCartao,
      pagamentos,
    );
  });
}

export function agregar_gasto_cartao_por_competencia(
  movimentos: Array<{
    tipo: string;
    valor: string | number;
    dataMovimento: string;
    cartaoId?: string | null;
    papel?: string | null;
    parcelaNumero?: number | null;
    status?: string | null;
    tipoGasto?: string | null;
    ignoradoEmRelatorio?: boolean;
    descricao?: string | null;
    descricaoFonte?: string | null;
  }>,
  fechamentoPorCartao: ReadonlyMap<string, number>,
  mes: string | ReadonlyMap<string, string>,
  vencimentoPorCartao: ReadonlyMap<string, number> = new Map(),
  pagamentos: PagamentoCiclo[] = [],
  tipoGasto?: Perfil,
): Map<string, { gasto: number; quantidade: number }> {
  const gastoPorCartao = new Map<string, { gasto: number; quantidade: number }>();
  for (const movimento of movimentos) {
    if (!eh_linha_da_fatura(movimento)) continue;
    const cartaoId = movimento.cartaoId;
    if (!cartaoId) continue;
    if (tipoGasto && movimento.tipoGasto !== tipoGasto) continue;
    const alvo = typeof mes === "string" ? mes : mes.get(cartaoId);
    if (!alvo) continue;
    if (
      !movimento_no_resultado_do_mes(
        movimento,
        alvo,
        fechamentoPorCartao,
        vencimentoPorCartao,
        pagamentos,
      )
    ) {
      continue;
    }
    const atual = gastoPorCartao.get(cartaoId) ?? { gasto: 0, quantidade: 0 };
    atual.gasto += valor_na_fatura(movimento);
    atual.quantidade += 1;
    gastoPorCartao.set(cartaoId, atual);
  }
  return gastoPorCartao;
}

/**
 * Agrega o cockpit a partir do ModuloRelatorios — o web só exibe.
 * `tipoGasto` recorta P&L, categorias, orçamentos e o gasto do card de cartões
 * pelo lançamento (não pelo perfil do plástico), em qualquer workspace.
 * Caixa e saldos ignoram.
 */
export async function montar_dashboard(
  usuarioId: string,
  dataAtual = hojeISO(),
  tipoGasto?: Perfil,
): Promise<DashboardResposta> {
  const hoje = hojeISO();
  const periodo = inicioFimMesAtual(dataAtual);
  const mes = dataAtual.slice(0, 7);
  const filtros = { usuarioId, periodo };
  const dataAnterior = paraDataISO(adicionarMeses(deISOParaData(periodo.de), -1));
  const periodoAnterior = inicioFimMesAtual(dataAnterior);
  const mesAnterior = periodoAnterior.de.slice(0, 7);
  const ateCaixa = hoje > periodo.ate ? hoje : periodo.ate;
  const periodoPnL = {
    ...periodo_amplo_do_ciclo(periodo, 2),
    ate: inicioFimMesAtual(paraDataISO(adicionarMeses(deISOParaData(periodo.de), 1))).ate,
  };

  const [
    saldosVisao,
    historicoVisao,
    cartoesVisao,
    cartoesDb,
    futuroVisao,
    movimentosAmplo,
    categoriasDb,
    movimentosQuitadas,
    movimentosCaixa,
    escopo,
    fluxoVisao,
    oficiais,
  ] =
    await Promise.all([
      relatorios.consultar_visao("saldos", { usuarioId }, dataAtual),
      relatorios.consultar_visao("historico", filtros, dataAtual),
      relatorios.consultar_visao("cartoes", { usuarioId }, dataAtual),
      repositorio.listarCartoes(usuarioId),
      relatorios.consultar_visao("futuro", { usuarioId, periodo }, dataAtual),
      repositorio.listarMovimentos(usuarioId, { periodo: periodoPnL }),
      repositorio.listarCategorias(usuarioId),
      repositorio.listarMovimentos(usuarioId, {
        periodo: {
          de: inicioFimMesAtual(paraDataISO(adicionarMeses(deISOParaData(periodo.de), -1))).de,
          ate: inicioFimMesAtual(paraDataISO(adicionarMeses(deISOParaData(periodo.de), 1))).ate,
        },
        incluirIgnorados: true,
      }),
      repositorio.listarMovimentos(usuarioId, {
        periodo: { de: periodo.de, ate: ateCaixa },
        incluirIgnorados: true,
      }),
      obter_escopo_leitura(usuarioId),
      relatorios.consultar_visao("fluxo", { usuarioId, periodo }, dataAtual),
      repositorio.listarFaturasOficiais(usuarioId),
    ]);

  if (
    saldosVisao.tipo !== "saldos" ||
    historicoVisao.tipo !== "historico" ||
    cartoesVisao.tipo !== "cartoes" ||
    futuroVisao.tipo !== "futuro" ||
    fluxoVisao.tipo !== "fluxo"
  ) {
    throw new Error("Resposta inesperada do ModuloRelatorios no dashboard.");
  }

  const saldos = saldosVisao.dados;
  const historico = historicoVisao.dados;
  const cartoes = cartoesVisao.dados;
  const cartoesCiclo = [...cartoesDb, ...cartoes.cartoes];
  const fechamentoPorCartao = mapa_fechamento_cartoes(cartoesCiclo);
  const vencimentoPorCartao = mapa_vencimento_cartoes(cartoesCiclo);
  const mesCivilHoje = hoje.slice(0, 7);
  const porFechamento = (mesAlvo: string) =>
    new Map(
      [...cartoesDb, ...cartoes.cartoes].map((cartao) => [
        cartao.id,
        mes_gasto_do_cartao({
          mesSelecionado: mesAlvo,
          hoje,
          fechamento: cartao.fechamento,
        }),
      ]),
    );
  const mesGastoPorCartao = porFechamento(mes);
  const mesGastoAnteriorPorCartao = porFechamento(mesAnterior);
  const pagamentosCiclo: PagamentoCiclo[] = pagamentos_ciclo_de(movimentosQuitadas);
  const movimentosPnL = filtrar_movimentos_do_resultado(
    movimentosAmplo,
    mesGastoPorCartao,
    mes,
    fechamentoPorCartao,
    vencimentoPorCartao,
    pagamentosCiclo,
  );
  const movimentosPnLAnterior = filtrar_movimentos_do_resultado(
    movimentosAmplo,
    mesGastoAnteriorPorCartao,
    mesAnterior,
    fechamentoPorCartao,
    vencimentoPorCartao,
    pagamentosCiclo,
  );
  const gastoPorCartao = agregar_gasto_cartao_por_competencia(
    movimentosAmplo,
    fechamentoPorCartao,
    mesGastoPorCartao,
    vencimentoPorCartao,
    pagamentosCiclo,
    tipoGasto,
  );
  const oficialPorChave = new Map(
    oficiais.map((fatura) => [`${fatura.cartaoId}:${fatura.competencia}`, fatura.total] as const),
  );

  const idsCartoes = cartoes.cartoes.map((cartao) => cartao.id);
  const origens = await mapear_origem_cartoes(idsCartoes);
  const plasticoPorId = new Map(
    cartoesDb.map((cartao) => [cartao.id, cartao.dadosPlasticosCifrados] as const),
  );

  const cartoesDetalhe: DashboardCartao[] = cartoes.cartoes.map((cartao) => {
    const gasto = gastoPorCartao.get(cartao.id) ?? { gasto: 0, quantidade: 0 };
    const competenciaCiclo = mesGastoPorCartao.get(cartao.id) ?? mes;
    const ciclo = intervalo_ciclo_fatura(competenciaCiclo, cartao.fechamento);
    const aplicado = aplicar_total_oficial(
      gasto.gasto,
      oficialPorChave.get(`${cartao.id}:${competenciaCiclo}`),
    );
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
      gastoMes: aplicado.total,
      quantidadeLancamentos: gasto.quantidade,
      gastoEhFaturaAtual: mes === mesCivilHoje,
      competenciaCiclo,
      cicloInicio: ciclo.inicio,
      cicloFim: ciclo.fim,
      totalOficial: aplicado.totalOficial,
      ajusteFatura: aplicado.ajuste,
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
  const movimentosNatureza = filtrar_movimentos_por_natureza(movimentosPnL, tipoGasto);
  const movimentosNaturezaAnterior = filtrar_movimentos_por_natureza(
    movimentosPnLAnterior,
    tipoGasto,
  );
  const totaisMes = somar_receitas_despesas(movimentosNatureza);
  const totaisAnterior = somar_receitas_despesas(movimentosNaturezaAnterior);
  const resultadoMes = arredondar(totaisMes.receitas - totaisMes.despesas);
  const resultadoAnterior = arredondar(totaisAnterior.receitas - totaisAnterior.despesas);

  const naoClassificado = contar_nao_classificados_em(movimentosPnL, categoriasDb);
  const fluxoSaldo = montar_fluxo_caixa({
    saldoAtual: saldos.totalGeral,
    hoje,
    periodo,
    movimentos: movimentosCaixa,
  });
  const fluxoResultado = montar_fluxo_resultado(movimentosNatureza, periodo);
  const visualPorNome = new Map(
    categoriasDb.map((item) => [item.nome, { icone: item.icone, cor: item.cor }] as const),
  );
  const gastosPorCategoria = montar_ranking_tipo(movimentosNatureza, categoriasDb, "despesa");
  const receitasPorCategoria = montar_ranking_tipo(movimentosNatureza, categoriasDb, "receita");
  const natureza = agregar_totais_por_natureza(movimentosPnL);
  const cruzamento = escopo.visaoAgregada
    ? null
    : {
        totalPessoalComEmpresa: fluxoVisao.dados.totalPessoalComEmpresa,
        totalEmpresaComPessoal: fluxoVisao.dados.totalEmpresaComPessoal,
      };
  const recentes = historico.dias
    .flatMap((dia) =>
      dia.itens.map((item) => {
        const visual = item.categoriaNome ? visualPorNome.get(item.categoriaNome) : undefined;
        return {
          id: item.id,
          data: dia.data,
          descricao: item.descricao,
          valor: item.valor,
          tipo: item.tipo,
          categoriaNome: item.categoriaNome,
          origemNome: item.contaNome ?? (item.cartaoNome ? `Cartão ${item.cartaoNome}` : null),
          icone: visual?.icone ?? "geral",
          cor: visual?.cor ?? "neutro",
        };
      }),
    )
    .slice(0, 12);

  let orcamentos: OrcamentoDashboard[] = [];
  try {
    const status = await listar_status_orcamentos(usuarioId, dataAtual, undefined, tipoGasto);
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
    movimentos: movimentosAmplo,
    pagamentosFatura: movimentosQuitadas,
    tipoGasto,
    // O web manda o dia 1 do mês selecionado; vencido/em aberto compara com hoje de verdade.
    hoje,
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
      receitasMes: totaisMes.receitas,
      despesasMes: totaisMes.despesas,
      resultadoMes,
      saldoPeriodo: historico.saldoPeriodo,
      variacaoReceitas: variacao_percentual(totaisMes.receitas, totaisAnterior.receitas),
      variacaoDespesas: variacao_percentual(totaisMes.despesas, totaisAnterior.despesas),
      variacaoResultado: variacao_percentual(resultadoMes, resultadoAnterior),
    },
    tipoGasto: tipoGasto ?? null,
    natureza,
    cruzamento,
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

export function contar_nao_classificados_em(
  movimentos: Array<{
    tipo: string;
    valor: string | number;
    categoriaId: string | null;
    papel?: string | null;
  }>,
  categorias: Array<{ id: string; nome: string }>,
): { quantidade: number; total: number } {
  const categoria = categorias.find(
    (item) =>
      item.nome.toLocaleLowerCase("pt-BR") ===
      CATEGORIA_NAO_CLASSIFICADO.toLocaleLowerCase("pt-BR"),
  );
  if (!categoria) return { quantidade: 0, total: 0 };

  let total = 0;
  let quantidade = 0;
  for (const movimento of movimentos) {
    if (movimento.categoriaId !== categoria.id) continue;
    if (movimento.tipo !== "despesa" && movimento.tipo !== "receita") continue;
    if (movimento.papel === "pagamento_fatura") continue;
    quantidade += 1;
    total += Number(movimento.valor);
  }
  return { quantidade, total };
}

function efeito_caixa(tipo: string, valor: number): number {
  if (tipo === "receita" || tipo === "reembolso" || tipo === "estorno" || tipo === "aporte") {
    return valor;
  }
  if (tipo === "despesa" || tipo === "retirada") {
    return -valor;
  }
  return 0;
}

/**
 * Saldo das contas ao fim de cada dia do mês. Inclui Pix de fatura (saiu da
 * conta) e ignora compra no cartão (ainda não saiu). O último dia com o mês
 * ainda em curso coincide com o saldo disponível.
 */
export function montar_fluxo_caixa(entrada: {
  saldoAtual: number;
  hoje: string;
  periodo: { de: string; ate: string };
  movimentos: Array<{
    dataMovimento: string;
    tipo: string;
    valor: string | number;
    status: string;
    contaId?: string | null;
    cartaoId?: string | null;
  }>;
}): Array<{ data: string; saldo: number }> {
  const naConta = entrada.movimentos.filter(
    (movimento) => movimento.status === "realizado" && movimento.contaId,
  );

  let netPeriodo = 0;
  let netDepois = 0;
  const porDia = new Map<string, number>();
  for (const movimento of naConta) {
    const dia = String(movimento.dataMovimento).slice(0, 10);
    const efeito = efeito_caixa(movimento.tipo, Number(movimento.valor));
    if (efeito === 0) continue;
    if (dia >= entrada.periodo.de && dia <= entrada.periodo.ate) {
      netPeriodo += efeito;
      porDia.set(dia, (porDia.get(dia) ?? 0) + efeito);
    } else if (dia > entrada.periodo.ate && dia <= entrada.hoje) {
      netDepois += efeito;
    }
  }

  const saldoFim = arredondar(entrada.saldoAtual - netDepois);
  let saldo = arredondar(saldoFim - netPeriodo);
  const pontos: Array<{ data: string; saldo: number }> = [];
  const inicio = deISOParaData(entrada.periodo.de);
  const fim = deISOParaData(entrada.periodo.ate);
  for (
    let cursor = new Date(inicio);
    cursor.getTime() <= fim.getTime();
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const data = paraDataISO(cursor);
    saldo = arredondar(saldo + (porDia.get(data) ?? 0));
    pontos.push({ data, saldo });
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
    const diaBruto = String(movimento.dataMovimento).slice(0, 10);
    const dia = diaBruto < periodo.de ? periodo.de : diaBruto > periodo.ate ? periodo.ate : diaBruto;
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
  futuro: Array<{
    descricao: string;
    valor: number;
    data: string;
    origem: "parcela" | "movimento";
    cartaoId?: string | null;
  }>;
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
    id?: string;
    status: string;
    papel?: string | null;
    cartaoFaturaId?: string | null;
    competenciaFatura?: string | null;
    dataMovimento?: string;
    valor?: string | number;
    tipo?: string;
    cartaoId?: string | null;
    contaId?: string | null;
    descricao?: string;
  }>;
  tipoGasto?: Perfil;
  hoje: string;
  periodo: { de: string; ate: string };
}): ProximoPagamento[] {
  const itens: ProximoPagamento[] = [];
  const mesAgenda = entrada.periodo.de.slice(0, 7);
  const cartoes = entrada.cartoes;
  const cartaoPorIdTodos = new Map(entrada.cartoes.map((cartao) => [cartao.id, cartao]));
  const creditosPorCartao = new Map<string, NonNullable<typeof entrada.pagamentosFatura>>();
  const ciclosPagos = new Set<string>();
  for (const movimento of entrada.pagamentosFatura ?? []) {
    if (movimento.status === "cancelado") continue;
    if (movimento.papel !== "pagamento_fatura") continue;
    if (!eh_credito_quitacao_da_fatura(movimento)) continue;
    const cartaoId = movimento.cartaoId;
    if (!cartaoId) continue;
    const cartaoQuitacao = cartaoPorIdTodos.get(cartaoId);
    const dataPag = movimento.dataMovimento ? String(movimento.dataMovimento).slice(0, 10) : "";
    const competencia = cartaoQuitacao
      ? competencia_quitacao_fatura(
          dataPag || `${mesAgenda}-01`,
          cartaoQuitacao.fechamento,
          cartaoQuitacao.vencimento,
          movimento.competenciaFatura,
        )
      : movimento.competenciaFatura;
    if (competencia) ciclosPagos.add(`${cartaoId}:${competencia}`);
    if (!dataPag.startsWith(mesAgenda)) continue;
    const lista = creditosPorCartao.get(cartaoId) ?? [];
    lista.push(movimento);
    creditosPorCartao.set(cartaoId, lista);
  }
  const cartaoPorId = new Map(cartoes.map((cartao) => [cartao.id, cartao]));

  const coberto_pela_fatura = (cartaoId: string | null | undefined, _data: string): boolean => {
    if (!cartaoId) return false;
    return cartaoPorId.has(cartaoId);
  };

  const vencida_do_cartao = (
    cartaoId: string | null | undefined,
    data: string,
  ): boolean => {
    if (!cartaoId) return data < entrada.hoje;
    const cartao = cartaoPorId.get(cartaoId);
    if (!cartao) return data < entrada.hoje;
    const competencia = competencia_ciclo_da_data(data, cartao.fechamento);
    const dia = String(cartao.vencimento).padStart(2, "0");
    return `${competencia}-${dia}` < entrada.hoje;
  };

  for (const item of entrada.futuro) {
    if (coberto_pela_fatura(item.cartaoId, item.data)) continue;
    itens.push({
      id: `${item.origem}-${item.data}-${item.descricao}`,
      data: item.data,
      descricao: item.descricao,
      valor: item.valor,
      origem: item.origem === "parcela" ? "parcela" : "previsto",
      contaNome: null,
      vencida: vencida_do_cartao(item.cartaoId, item.data),
      pago: false,
    });
  }

  for (const movimento of entrada.movimentos) {
    if (movimento.status !== "previsto") continue;
    if (movimento.tipo !== "despesa" && movimento.tipo !== "retirada") continue;
    if (eh_movimento_parcelado(movimento)) continue;
    const data = String(movimento.dataMovimento).slice(0, 10);
    if (coberto_pela_fatura(movimento.cartaoId, data)) continue;
    itens.push({
      id: movimento.id,
      data,
      descricao: movimento.descricao,
      valor: Number(movimento.valor),
      origem: movimento.fonte === "recorrencia" ? "recorrente" : "previsto",
      contaNome: null,
      vencida: vencida_do_cartao(movimento.cartaoId, data),
      pago: false,
    });
  }

  for (const cartao of cartoes) {
    const creditos = [...(creditosPorCartao.get(cartao.id) ?? [])].sort((a, b) =>
      String(a.dataMovimento ?? "").localeCompare(String(b.dataMovimento ?? "")),
    );
    for (const credito of creditos) {
      const pagamento = credito.dataMovimento ? String(credito.dataMovimento).slice(0, 10) : "";
      const cicloQuitado = competencia_quitacao_fatura(
        pagamento || `${mesAgenda}-01`,
        cartao.fechamento,
        cartao.vencimento,
        credito.competenciaFatura,
      );
      const vencimentoPago = data_vencimento_do_ciclo(
        cicloQuitado,
        cartao.fechamento,
        cartao.vencimento,
      );
      itens.push({
        id: credito.id ?? `fatura-${cartao.id}-${pagamento || "pago"}`,
        data: vencimentoPago,
        dataPagamento: pagamento || null,
        descricao: `Fatura ${cartao.nome}`,
        valor: credito.valor == null || credito.valor === "" ? cartao.gastoMes : Number(credito.valor),
        origem: "fatura",
        contaNome: cartao.nome,
        vencida: false,
        pago: true,
        competenciaCiclo: cicloQuitado,
        situacao: "paga",
      });
    }

    if (ciclosPagos.has(`${cartao.id}:${mesAgenda}`)) continue;
    if (entrada.tipoGasto && cartao.gastoMes === 0) continue;
    const vencimentoAberto = data_vencimento_do_ciclo(
      mesAgenda,
      cartao.fechamento,
      cartao.vencimento,
    );
    const { fim } = intervalo_ciclo_fatura(mesAgenda, cartao.fechamento);
    const situacao = situacao_ciclo_aberto(entrada.hoje, fim, vencimentoAberto);
    itens.push({
      id: `fatura-${cartao.id}`,
      data: vencimentoAberto,
      descricao: `Fatura ${cartao.nome}`,
      valor: cartao.gastoMes,
      origem: "fatura",
      contaNome: cartao.nome,
      vencida: situacao === "vencida",
      pago: false,
      competenciaCiclo: mesAgenda,
      situacao,
    });
  }

  const vistos = new Set<string>();
  return itens
    .filter((item) => {
      const chave = `${item.id}|${item.descricao}|${item.data}|${item.dataPagamento ?? ""}|${item.valor}`;
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    })
    .sort((a, b) => {
      if (a.pago !== b.pago) return Number(a.pago) - Number(b.pago);
      if (a.vencida !== b.vencida) return Number(b.vencida) - Number(a.vencida);
      const dataA = a.dataPagamento ?? a.data;
      const dataB = b.dataPagamento ?? b.data;
      return dataA.localeCompare(dataB) || a.descricao.localeCompare(b.descricao, "pt-BR");
    })
    .slice(0, 16);
}

function situacao_ciclo_aberto(
  hoje: string,
  fimCiclo: string,
  vencimento: string,
): "aberta" | "a_pagar" | "vencida" {
  if (hoje <= fimCiclo) return "aberta";
  if (vencimento < hoje) return "vencida";
  return "a_pagar";
}

/** Crédito de quitação no extrato do cartão — o débito na conta não entra nos Próximos. */
function eh_credito_quitacao_da_fatura(movimento: {
  tipo?: string;
  cartaoId?: string | null;
  contaId?: string | null;
  descricao?: string;
}): boolean {
  if (!movimento.cartaoId) return false;
  if (movimento.tipo === "receita" || movimento.tipo === "estorno") return true;
  if (movimento.descricao && eh_credito_quitacao_no_cartao(movimento.descricao)) return true;
  if (!movimento.contaId && movimento.tipo !== "despesa" && movimento.tipo !== "retirada") {
    return true;
  }
  return false;
}
