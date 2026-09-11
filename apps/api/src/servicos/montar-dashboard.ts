import { and, eq, inArray } from "drizzle-orm";
import { CATEGORIA_NAO_CLASSIFICADO, alocacaoFatura, obter_banco } from "@lancai/banco";
import { mascara_final4_do_payload } from "@lancai/ia";
import {
  ModuloRelatorios,
  RepositorioRelatoriosDrizzle,
  inicioFimMesAtual,
} from "@lancai/relatorios";
import {
  adicionarMeses,
  adiar_compras_do_fechamento_ja_pago,
  aplicar_total_oficial,
  ciclo_aberto_em,
  ciclo_do_movimento,
  competencia_alvo_do_modo_fatura,
  data_fechamento_do_ciclo,
  data_vencimento_do_ciclo,
  intervalo_ciclo_fatura,
  deISOParaData,
  efeito_valor_movimento,
  eh_linha_da_fatura,
  valor_na_fatura,
  hojeISO,
  mapa_fechamento_cartoes,
  mapa_vencimento_cartoes,
  movimento_no_resultado_do_mes,
  pagamentos_ciclo_de,
  type PagamentoCiclo,
  paraDataISO,
  periodo_amplo_do_ciclo,
  type Perfil,
  somar_pagamentos_fatura,
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

export type StatusFaturaDashboard =
  | "paga"
  | "parcial"
  | "em_aberto"
  | "aguardando_confirmacao"
  | "prevista";

/**
 * Reconciliação informativa contra `bill_allocation` (ver
 * docs/AUDITORIA_TECNICA_CARTAOES_FATURAS_V2.md). Nunca é autoridade — não
 * altera `total`/`totalOficial`/`saldo`/`status` — só sinaliza que parte do
 * que compõe esta linha ainda não foi confirmado pelo banco (`providerBillId`),
 * e sim previsto por `providerBillForecastDate` ou por regra de ciclo local.
 */
export interface ConfiancaBaixaFatura {
  quantidade: number;
  valor: number;
  /** Alguma alocação usa `provider_forecast`: previsão do banco, ainda pode mudar de mês. */
  temPrevisaoDoBanco: boolean;
}

export interface LinhaFaturaDashboard {
  cartaoId: string;
  cartaoNome: string;
  competencia: string;
  total: number;
  totalOficial: number | null;
  totalPago: number;
  saldo: number;
  status: StatusFaturaDashboard;
  origem: "oficial" | "aberta" | "prevista";
  cicloInicio: string;
  cicloFim: string;
  dataFechamento: string;
  dataVencimento: string;
  quantidadeLancamentos: number;
  ajuste: number | null;
  /** Ausente quando não há nenhuma alocação de baixa confiança para esta competência. */
  confiancaBaixa?: ConfiancaBaixaFatura;
}

export interface SerieFaturasDashboard {
  competencia: string;
  linhas: LinhaFaturaDashboard[];
  total: number;
  totalOficial: number;
  totalPago: number;
  saldo: number;
  quantidadeCartoes: number;
  status: StatusFaturaDashboard;
}

export interface RankingCategoria {
  categoriaNome: string;
  total: number;
  icone: string;
  cor: string;
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
  orcamentos: OrcamentoDashboard[];
  contas: Array<{ nome: string; perfil: string; saldoAtual: number }>;
  cartoes: DashboardCartao[];
  faturas: {
    meses: SerieFaturasDashboard[];
    mesAtual: string;
    inicio: string;
    fim: string;
  };
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
  movimentos: Array<{
    tipo: string;
    valor: string | number;
    papel?: string | null;
    efeitoValor?: "soma" | "subtrai" | null;
  }>,
): { receitas: number; despesas: number } {
  let receitas = 0;
  let despesas = 0;
  for (const movimento of movimentos) {
    if (movimento.papel === "pagamento_fatura") continue;
    // Override de regra manda mesmo fora do par receita/despesa (mantém o
    // padrão — só receita/despesa entram no P&L — quando não há override).
    if (movimento.efeitoValor === "subtrai") {
      receitas += Number(movimento.valor);
    } else if (movimento.efeitoValor === "soma") {
      despesas += Number(movimento.valor);
    } else if (movimento.tipo === "receita") {
      receitas += Number(movimento.valor);
    } else if (movimento.tipo === "despesa") {
      despesas += Number(movimento.valor);
    }
  }
  return { receitas: arredondar(receitas), despesas: arredondar(despesas) };
}

export function filtrar_movimentos_do_resultado<
  T extends {
    dataMovimento: string;
    cartaoId?: string | null;
    parcelaNumero?: number | null;
    status?: string | null;
    deslocamentoFatura?: number | null;
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
    efeitoValor?: "soma" | "subtrai" | null;
    deslocamentoFatura?: number | null;
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

type MovimentoFaturaDashboard = {
  tipo: string;
  valor: string | number;
  dataMovimento: string;
  cartaoId?: string | null;
  cartaoFaturaId?: string | null;
  competenciaFatura?: string | null;
  papel?: string | null;
  parcelaNumero?: number | null;
  status?: string | null;
  tipoGasto?: string | null;
  ignoradoEmRelatorio?: boolean;
  descricao?: string | null;
  descricaoFonte?: string | null;
  /** Override de regra (`somar_valor`/`subtrair_valor`) sobre o sinal do lançamento. */
  efeitoValor?: "soma" | "subtrai" | null;
  /** Ajuste manual do ciclo (⋯ do Extrato ou assistente) — ver `ExtraCicloMovimento`. */
  deslocamentoFatura?: number | null;
};

/**
 * `origemManual`: cartão sem sincronização Pluggy/Open Finance — `totalOficial`
 * nunca chega pra ele (esse campo só vem do provedor). Por isso, pra cartão
 * manual, a comparação usa sempre `total` (líquido local) em vez de esperar
 * confirmação do banco; sem isso, faturas manuais fechadas e pagas ficavam
 * presas em "aguardando_confirmacao" pra sempre.
 */
function status_fatura(
  totalOficial: number | null,
  total: number,
  totalPago: number,
  cicloAtual: boolean,
  prevista: boolean,
  origemManual: boolean,
): StatusFaturaDashboard {
  // Confirmação do banco: ela é a autoridade.
  if (totalOficial != null) {
    if (totalPago >= totalOficial - 0.01) return "paga";
    if (totalPago > 0.01) return "parcial";
    return "em_aberto";
  }

  if (cicloAtual) return "em_aberto";
  if (prevista) return "prevista";

  // Fatura fechada sem totalOficial: cartão manual nunca vai receber
  // confirmação do banco, então usa o total local como referência definitiva.
  if (origemManual) {
    if (totalPago >= total - 0.01 && total > 0) return "paga";
    if (totalPago > 0.01) return "parcial";
    return "em_aberto";
  }

  // Cartão sincronizado (Pluggy): fatura fechada, mas o banco ainda não
  // publicou o total oficial. Se já bateu o valor local, mostra paga —
  // senão, ainda estamos esperando a confirmação.
  if (totalPago >= total - 0.01 && total > 0) return "paga";
  if (totalPago > 0.01) return "parcial";
  return "aguardando_confirmacao";
}

/**
 * Uma passada só sobre `movimentos` alimenta o líquido de TODOS os
 * cartão+ciclo de uma vez — chamado uma única vez por
 * `montar_serie_faturas_dashboard`, em vez de `agregar_gasto_cartao_por_competencia`
 * (uma varredura completa da lista) rodar de novo pra CADA combinação de
 * mês×cartão da série (12+ meses × N cartões — o mesmo tipo de
 * O(ciclos × lançamentos) já corrigido antes em
 * `adiar_compras_do_fechamento_ja_pago`, aqui na montagem da linha).
 */
function gasto_por_cartao_e_ciclo(
  movimentos: MovimentoFaturaDashboard[],
  fechamentoPorCartao: ReadonlyMap<string, number>,
  vencimentoPorCartao: ReadonlyMap<string, number>,
  pagamentos: PagamentoCiclo[],
): Map<string, { gasto: number; quantidade: number }> {
  const mapa = new Map<string, { gasto: number; quantidade: number }>();
  for (const movimento of movimentos) {
    if (!eh_linha_da_fatura(movimento)) continue;
    const cartaoId = movimento.cartaoId;
    if (!cartaoId) continue;
    const fechamento = fechamentoPorCartao.get(cartaoId);
    if (fechamento == null) continue;
    const ciclo = ciclo_do_movimento(movimento.dataMovimento, cartaoId, fechamento, {
      vencimento: vencimentoPorCartao.get(cartaoId),
      parcelaNumero: movimento.parcelaNumero,
      status: movimento.status,
      pagamentos,
      deslocamentoFatura: movimento.deslocamentoFatura,
    });
    const chave = `${cartaoId}:${ciclo}`;
    const atual = mapa.get(chave) ?? { gasto: 0, quantidade: 0 };
    atual.gasto += valor_na_fatura(movimento);
    atual.quantidade += 1;
    mapa.set(chave, atual);
  }
  return mapa;
}

function montar_linha_fatura(
  cartao: { id: string; nome: string; fechamento: number; vencimento: number; sincronizada?: boolean },
  mesTela: string,
  cicloFecha: string,
  hoje: string,
  gastoPorChave: ReadonlyMap<string, { gasto: number; quantidade: number }>,
  movimentosPagamento: MovimentoFaturaDashboard[],
  oficiais: ReadonlyMap<string, { total: number }>,
  alocacoesBaixaConfianca: ReadonlyMap<string, ConfiancaBaixaFatura> | undefined,
): LinhaFaturaDashboard {
  const ciclo = intervalo_ciclo_fatura(cicloFecha, cartao.fechamento);
  const oficial = oficiais.get(`${cartao.id}:${cicloFecha}`);
  const gasto = gastoPorChave.get(`${cartao.id}:${cicloFecha}`) ?? { gasto: 0, quantidade: 0 };
  const cicloAberto = ciclo_aberto_em(hoje, cartao.fechamento);
  const totalOficial = oficial?.total ?? null;
  const total = totalOficial ?? arredondar(gasto.gasto);
  const totalPago = somar_pagamentos_fatura(
    movimentosPagamento,
    cartao.id,
    cicloFecha,
    cartao.fechamento,
    cartao.vencimento,
    // Total oficial é fixo e ignora o líquido local — sem isso, um crédito
    // marcado por regra (subtrair_valor) nunca abateria o saldo quando o
    // banco já confirmou o total. Sem oficial, o crédito já está líquido em
    // `gasto`/`total` (via valor_na_fatura); somar aqui contaria em dobro.
    { incluirCreditosDeRegra: totalOficial != null },
  );
  const cicloAtual = cicloFecha === cicloAberto;
  const futura = mesTela > hoje.slice(0, 7);
  // Mês futuro sem confirmação do banco é sempre "prevista" — não importa se
  // já existe algum lançamento projetado (`gasto.quantidade`) ou não; a
  // grande maioria dos meses futuros começa vazia (`quantidade === 0`) e
  // isso não deve empurrar pra "aguardando_confirmacao"/"em_aberto".
  const prevista = totalOficial == null && futura;
  const origem = totalOficial != null ? "oficial" : cicloAtual ? "aberta" : "prevista";
  const base = totalOficial ?? total;
  const confiancaBaixa = alocacoesBaixaConfianca?.get(`${cartao.id}:${cicloFecha}`);
  return {
    cartaoId: cartao.id,
    cartaoNome: cartao.nome,
    competencia: mesTela,
    total,
    totalOficial,
    totalPago,
    saldo: arredondar(Math.max(0, base - totalPago)),
    status: status_fatura(totalOficial, total, totalPago, cicloAtual, prevista, cartao.sincronizada === false),
    origem,
    cicloInicio: ciclo.inicio,
    cicloFim: ciclo.fim,
    dataFechamento: data_fechamento_do_ciclo(cicloFecha, cartao.fechamento),
    dataVencimento: data_vencimento_do_ciclo(cicloFecha, cartao.fechamento, cartao.vencimento),
    quantidadeLancamentos: gasto.quantidade,
    ajuste: totalOficial == null ? null : arredondar(totalOficial - gasto.gasto),
    ...(confiancaBaixa ? { confiancaBaixa } : {}),
  };
}

export function montar_serie_faturas_dashboard(entrada: {
  /** `sincronizada: false` (cartão manual) nunca recebe `totalOficial` — só vem do Pluggy. */
  cartoes: Array<{
    id: string;
    nome: string;
    fechamento: number;
    vencimento: number;
    sincronizada?: boolean;
  }>;
  oficiais: Array<{ cartaoId: string; competencia: string; total: number; dataFechamento: string | null }>;
  movimentos: MovimentoFaturaDashboard[];
  inicio: string;
  fim: string;
  hoje: string;
  /**
   * Chave `${cartaoId}:${competencia}` → reconciliação informativa contra
   * `bill_allocation`. Puramente aditivo (ver `ConfiancaBaixaFatura`).
   */
  alocacoesBaixaConfianca?: ReadonlyMap<string, ConfiancaBaixaFatura>;
  /**
   * Pagamentos de fatura já conhecidos (ver `pagamentos_ciclo_de`) — sem
   * isso, `ciclo_do_movimento` nunca desloca uma compra por antecipação
   * (`aplicar_antecipacao` sai cedo quando a lista está vazia), e o total de
   * um ciclo ainda aberto diverge do mesmo cálculo feito em outro lugar do
   * dashboard com essa lista preenchida.
   */
  pagamentos?: PagamentoCiclo[];
}): SerieFaturasDashboard[] {
  const fechamentoPorCartao = new Map(entrada.cartoes.map((cartao) => [cartao.id, cartao.fechamento]));
  const vencimentoPorCartao = new Map(entrada.cartoes.map((cartao) => [cartao.id, cartao.vencimento]));
  const oficiais = new Map(
    entrada.oficiais.map((fatura) => [`${fatura.cartaoId}:${fatura.competencia}`, fatura] as const),
  );
  const alocacoesBaixaConfianca = entrada.alocacoesBaixaConfianca;
  const pagamentos = entrada.pagamentos ?? [];
  const meses: string[] = [];
  for (
    let cursor = deISOParaData(entrada.inicio);
    cursor <= deISOParaData(entrada.fim);
    cursor = adicionarMeses(cursor, 1)
  ) {
    meses.push(paraDataISO(cursor).slice(0, 7));
  }

  const movimentosAjustados = adiar_compras_do_fechamento_ja_pago(
    entrada.movimentos,
    entrada.cartoes,
    (cartaoId, competencia) => oficiais.get(`${cartaoId}:${competencia}`)?.total ?? null,
    pagamentos,
  );
  const gastoPorChave = gasto_por_cartao_e_ciclo(
    movimentosAjustados,
    fechamentoPorCartao,
    vencimentoPorCartao,
    pagamentos,
  );
  // `somar_pagamentos_fatura` só olha pagamento de fatura (ou crédito de
  // regra) — filtrar antes deixa a chamada por linha barata sem mudar o
  // resultado (o resto já seria descartado pelos filtros internos dela).
  const movimentosPagamento = movimentosAjustados.filter(
    (movimento) => movimento.papel === "pagamento_fatura" || movimento.efeitoValor === "subtrai",
  );

  return meses.map((mesTela) => {
    const linhas = entrada.cartoes.map((cartao) => {
      const cicloFecha = competencia_alvo_do_modo_fatura({
        mes: mesTela,
        fechamento: cartao.fechamento,
        vencimento: cartao.vencimento,
      });
      return montar_linha_fatura(
        cartao,
        mesTela,
        cicloFecha,
        entrada.hoje,
        gastoPorChave,
        movimentosPagamento,
        oficiais,
        alocacoesBaixaConfianca,
      );
    });
    const mesAtual = entrada.hoje.slice(0, 7);
    const comDados = linhas.filter(
      (linha) => linha.totalOficial != null || linha.quantidadeLancamentos > 0 || linha.competencia === mesAtual,
    );
    const totalOficial = arredondar(comDados.reduce((total, linha) => total + (linha.totalOficial ?? 0), 0));
    const total = arredondar(comDados.reduce((total, linha) => total + linha.total, 0));
    const totalPago = arredondar(comDados.reduce((total, linha) => total + linha.totalPago, 0));
    const saldo = arredondar(comDados.reduce((total, linha) => total + linha.saldo, 0));
    const status = comDados.some((linha) => linha.status === "parcial")
      ? "parcial"
      : comDados.some((linha) => linha.status === "em_aberto")
        ? "em_aberto"
        : comDados.some((linha) => linha.status === "aguardando_confirmacao")
          ? "aguardando_confirmacao"
          : comDados.some((linha) => linha.status === "prevista")
            ? "prevista"
            : "paga";
    return {
      competencia: mesTela,
      linhas: comDados,
      total,
      totalOficial,
      totalPago,
      saldo,
      quantidadeCartoes: comDados.length,
      status,
    };
  });
}

/**
 * Reconciliação informativa: agrega `bill_allocation` (isCurrent, status ainda
 * não confirmado) por cartão + competência, para o dashboard sinalizar que
 * parte do valor de uma fatura é previsão do banco (`providerBillForecastDate`)
 * ou regra de ciclo local — nunca confirmação. Não é lido por nenhum cálculo
 * de `total`/`totalOficial`/`saldo`/`status`; é só reconciliação visível
 * (ver docs/AUDITORIA_TECNICA_CARTAOES_FATURAS_V2.md, §G).
 */
export async function listar_alocacoes_baixa_confianca(entrada: {
  workspaceIds: string[];
  cartaoIds: string[];
}): Promise<Map<string, ConfiancaBaixaFatura>> {
  const mapa = new Map<string, ConfiancaBaixaFatura>();
  if (entrada.workspaceIds.length === 0 || entrada.cartaoIds.length === 0) return mapa;

  const linhas = await obter_banco()
    .select({
      cartaoId: alocacaoFatura.cartaoId,
      competencia: alocacaoFatura.competencia,
      status: alocacaoFatura.status,
      metodo: alocacaoFatura.metodo,
      valorAlocado: alocacaoFatura.valorAlocado,
    })
    .from(alocacaoFatura)
    .where(
      and(
        eq(alocacaoFatura.isCurrent, true),
        inArray(alocacaoFatura.status, ["previsto", "possivel", "nao_resolvido"]),
        inArray(alocacaoFatura.cartaoId, entrada.cartaoIds),
        inArray(alocacaoFatura.workspaceId, entrada.workspaceIds),
      ),
    );

  for (const linha of linhas) {
    if (!linha.competencia) continue;
    const chave = `${linha.cartaoId}:${linha.competencia}`;
    const atual = mapa.get(chave) ?? { quantidade: 0, valor: 0, temPrevisaoDoBanco: false };
    atual.quantidade += 1;
    atual.valor = arredondar(atual.valor + Number(linha.valorAlocado ?? 0));
    if (linha.metodo === "provider_forecast") atual.temPrevisaoDoBanco = true;
    mapa.set(chave, atual);
  }
  return mapa;
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
  // Série do card de faturas é independente do mês do cockpit: ancora em hoje
  // (não recentra ao navegar o mês do cockpit — isso fica intocado). Mas a
  // janela de busca dos lançamentos precisa cobrir os dois: `mes` do cockpit
  // alimenta o mesmo cálculo (ver `cartoesDetalhe` abaixo, que lê a linha já
  // computada aqui em vez de recalcular por conta própria) — sem isso, um
  // `mes` distante de hoje ficaria sem lançamentos carregados pra sua linha.
  const mesHoje = hoje.slice(0, 7);
  const mesMinFaturas = mes < mesHoje ? mes : mesHoje;
  const mesMaxFaturas = mes > mesHoje ? mes : mesHoje;
  const inicioFaturas = inicioFimMesAtual(
    paraDataISO(adicionarMeses(deISOParaData(`${mesMinFaturas}-01`), -11)),
  );
  const fimFaturas = inicioFimMesAtual(
    paraDataISO(adicionarMeses(deISOParaData(`${mesMaxFaturas}-01`), 5)),
  ).ate;
  const periodoFaturas = { de: inicioFaturas.de, ate: fimFaturas };
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
    movimentosAmplo,
    categoriasDb,
    movimentosQuitadas,
    movimentosFaturas,
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
        periodo: periodoFaturas,
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
    fluxoVisao.tipo !== "fluxo"
  ) {
    throw new Error("Resposta inesperada do ModuloRelatorios no dashboard.");
  }

  const saldos = saldosVisao.dados;
  const historico = historicoVisao.dados;
  const cartoes = cartoesVisao.dados;
  const cartoesCiclo = [
    ...new Map(
      [...cartoesDb, ...cartoes.cartoes].map((cartao) => [cartao.id, cartao] as const),
    ).values(),
  ];
  const fechamentoPorCartao = mapa_fechamento_cartoes(cartoesCiclo);
  const vencimentoPorCartao = mapa_vencimento_cartoes(cartoesCiclo);
  const mesCivilHoje = hoje.slice(0, 7);
  // Competência de fatura é sempre a do próprio mês selecionado — fechada
  // (já tem oficial ou já passou o fechamento) mostra o ciclo que fechou
  // naquele mês; aberta (ainda não fechou) é a previsão dos lançamentos
  // dentro do ciclo em andamento. Nenhum dos dois casos depende de "hoje":
  // "setembro" e "outubro" nunca podem apontar pro mesmo ciclo só porque o
  // calendário civil de hoje cai num ou no outro (era o bug do antigo
  // mes_gasto_do_cartao — removido).
  const pagamentosCiclo: PagamentoCiclo[] = pagamentos_ciclo_de(movimentosQuitadas);
  const semAliasPorCartao = new Map<string, string>();
  const movimentosPnL = filtrar_movimentos_do_resultado(
    movimentosAmplo,
    semAliasPorCartao,
    mes,
    fechamentoPorCartao,
    vencimentoPorCartao,
    pagamentosCiclo,
  );
  const movimentosPnLAnterior = filtrar_movimentos_do_resultado(
    movimentosAmplo,
    semAliasPorCartao,
    mesAnterior,
    fechamentoPorCartao,
    vencimentoPorCartao,
    pagamentosCiclo,
  );
  const oficialPorChave = new Map(
    oficiais.map((fatura) => [`${fatura.cartaoId}:${fatura.competencia}`, fatura.total] as const),
  );
  // Card Cartões, drawer e próximos pagamentos precisam da MESMA competência
  // que o gráfico de Faturas / Modo fatura já usa: `competencia_alvo_do_modo_fatura`
  // (eixo vencimento). Usar `mes` puro (eixo fechamento) só coincide quando
  // vencimento >= fechamento (ex.: Nu Mastercard); num cartão com vencimento
  // < fechamento (ex.: Azul Itaú fecha 30, vence 8), "setembro" já é o ciclo
  // que fechou em agosto — usar `mes` direto mostrava o ciclo errado (o que
  // ainda está aberto, fechando em setembro).
  const competenciaFaturaPorCartao = new Map(
    cartoesCiclo.map((cartao) => [
      cartao.id,
      competencia_alvo_do_modo_fatura({ mes, fechamento: cartao.fechamento, vencimento: cartao.vencimento }),
    ]),
  );
  // Mesma regra do gráfico de Faturas e do Modo fatura: compra que só chegou
  // depois que o ciclo já fechou e foi pago desloca pro ciclo seguinte —
  // senão o card Cartões soma no mês errado.
  const movimentosAmploAjustados = adiar_compras_do_fechamento_ja_pago(
    movimentosAmplo,
    cartoesCiclo,
    (cartaoId, competencia) => oficialPorChave.get(`${cartaoId}:${competencia}`) ?? null,
  );
  const gastoPorCartao = agregar_gasto_cartao_por_competencia(
    movimentosAmploAjustados,
    fechamentoPorCartao,
    competenciaFaturaPorCartao,
    vencimentoPorCartao,
    pagamentosCiclo,
    tipoGasto,
  );

  const idsCartoes = cartoesCiclo.map((cartao) => cartao.id);
  const origens = await mapear_origem_cartoes(idsCartoes);
  const plasticoPorId = new Map(
    cartoesDb.map((cartao) => [cartao.id, cartao.dadosPlasticosCifrados] as const),
  );

  // Calculado antes de `cartoesDetalhe` de propósito: o card Cartões lê o
  // total de cada cartão daqui (mesma linha que o gráfico de Faturas mostra
  // pro mesmo mês) em vez de recalcular por conta própria — os dois nunca
  // divergem porque passam a ser o mesmo objeto, não duas implementações
  // paralelas tentando concordar. Só quando `tipoGasto` filtra por natureza
  // (pessoal/empresa) o card volta a calcular à parte (abaixo): o gráfico de
  // Faturas sempre mostra a fatura inteira, sem esse recorte.
  const alocacoesBaixaConfianca = await listar_alocacoes_baixa_confianca({
    workspaceIds: escopo.workspaceIds,
    cartaoIds: idsCartoes,
  });
  const pagamentosFaturas = pagamentos_ciclo_de(movimentosFaturas);
  const faturas = montar_serie_faturas_dashboard({
    cartoes: cartoesCiclo.map((cartao) => ({
      id: cartao.id,
      nome: cartao.nome,
      fechamento: cartao.fechamento,
      vencimento: cartao.vencimento,
      sincronizada: cartao.sincronizada,
    })),
    oficiais,
    movimentos: movimentosFaturas,
    inicio: inicioFaturas.de,
    fim: fimFaturas,
    hoje,
    alocacoesBaixaConfianca,
    pagamentos: pagamentosFaturas,
  });
  const serieFaturasDoMes = faturas.find((serie) => serie.competencia === mes);

  const cartoesDetalhe: DashboardCartao[] = cartoesCiclo.map((cartao) => {
    const competenciaCiclo = competenciaFaturaPorCartao.get(cartao.id) ?? mes;
    const ciclo = intervalo_ciclo_fatura(competenciaCiclo, cartao.fechamento);
    const limite = Number(cartao.limite ?? 0);
    const comprometido = Number(
      "comprometido" in cartao && cartao.comprometido != null ? cartao.comprometido : 0,
    );
    const disponivel = Number(
      "disponivel" in cartao && cartao.disponivel != null
        ? cartao.disponivel
        : Math.max(0, limite - comprometido),
    );

    // Caminho unificado: a mesma linha que o gráfico de Faturas calculou pro
    // mês do cockpit. `tipoGasto` (recorte pessoal/empresa) não se aplica ao
    // gráfico de Faturas — nesse caso cai no cálculo à parte, de propósito.
    const linhaUnificada =
      tipoGasto == null ? serieFaturasDoMes?.linhas.find((linha) => linha.cartaoId === cartao.id) : undefined;

    let gastoMes: number;
    let quantidadeLancamentos: number;
    let totalOficial: number | null;
    let ajusteFatura: number | null;
    if (linhaUnificada) {
      gastoMes = linhaUnificada.total;
      quantidadeLancamentos = linhaUnificada.quantidadeLancamentos;
      totalOficial = linhaUnificada.totalOficial;
      ajusteFatura = linhaUnificada.ajuste;
    } else {
      const gasto = gastoPorCartao.get(cartao.id) ?? { gasto: 0, quantidade: 0 };
      const aplicado = aplicar_total_oficial(
        gasto.gasto,
        oficialPorChave.get(`${cartao.id}:${competenciaCiclo}`),
      );
      gastoMes = aplicado.total;
      quantidadeLancamentos = gasto.quantidade;
      totalOficial = aplicado.totalOficial;
      ajusteFatura = aplicado.ajuste;
    }

    return {
      id: cartao.id,
      nome: cartao.nome,
      perfil: cartao.perfil,
      limite,
      comprometido,
      disponivel,
      fechamento: cartao.fechamento,
      vencimento: cartao.vencimento,
      sincronizada: Boolean(cartao.sincronizada),
      instituicao: origens.get(cartao.id)?.instituicao ?? null,
      final4: mascara_final4_do_payload(plasticoPorId.get(cartao.id)),
      gastoMes,
      quantidadeLancamentos,
      gastoEhFaturaAtual: mes === mesCivilHoje,
      competenciaCiclo,
      cicloInicio: linhaUnificada?.cicloInicio ?? ciclo.inicio,
      cicloFim: linhaUnificada?.cicloFim ?? ciclo.fim,
      totalOficial,
      ajusteFatura,
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
    orcamentos,
    contas: saldos.contas,
    cartoes: cartoesDetalhe,
    faturas: {
      meses: faturas,
      mesAtual: mesHoje,
      inicio: inicioFaturas.de.slice(0, 7),
      fim: fimFaturas.slice(0, 7),
    },
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

function efeito_caixa(
  movimento: { tipo: string; efeitoValor?: "soma" | "subtrai" | null },
  valor: number,
): number {
  const efeito = efeito_valor_movimento(movimento);
  if (efeito === "subtrai") return valor;
  if (efeito === "soma") return -valor;
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
    efeitoValor?: "soma" | "subtrai" | null;
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
    const efeito = efeito_caixa(movimento, Number(movimento.valor));
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
  movimentos: Array<{
    dataMovimento: string;
    tipo: string;
    valor: string | number;
    efeitoValor?: "soma" | "subtrai" | null;
  }>,
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
    const efeito = efeito_valor_movimento(movimento);
    if (efeito === "subtrai") {
      atual.entradas += valor;
    } else if (efeito === "soma") {
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

