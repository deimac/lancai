import type { MovimentoResumo } from "./api";
import { eh_nao_classificado, precisa_revisao } from "./fila-revisao";
import {
  aplicar_total_oficial,
  agrupar_series_parcelamento,
  arredondar,
  competencia_alvo_do_modo_fatura,
  data_iso_parcela,
  data_vencimento_do_ciclo,
  eh_credito_quitacao_no_cartao,
  hojeISO,
  intervalo_ciclo_fatura,
  irmas_da_serie,
  mapa_fechamento_cartoes,
  mapa_vencimento_cartoes,
  na_fatura_do_recorte,
  pagamentos_ciclo_de,
  soma_cobrada_do_vencimento,
  valor_na_fatura,
} from "@lancai/tipos";
import { formatar_data_curta, formatar_intervalo_ciclo } from "./formatar";

export type FilaExtrato = "todas" | "banco" | "manual" | "revisar";

export type ClassificacaoExtrato =
  | "todas"
  | "usuario"
  | "regra"
  | "ia"
  | "sem_classificar";

export type OrigemExtrato =
  | { tipo: "todas" }
  | { tipo: "contas" }
  | { tipo: "cartoes" }
  | { tipo: "conta"; id: string }
  | { tipo: "cartao"; id: string };

export type TipoGastoExtrato = "todas" | "pessoal" | "empresa";

export type PapelExtrato = "todas" | "gastos" | "pagamentos_fatura";

export type CartaoCicloExtrato = { id: string; fechamento?: number | null; vencimento?: number | null };

export type VisaoExtrato = "movimentacoes" | "faturas";

export function visao_da_query(valor: string | null): VisaoExtrato {
  return valor === "faturas" ? "faturas" : "movimentacoes";
}

export function visao_para_query(visao: VisaoExtrato): string | null {
  return visao === "faturas" ? "faturas" : null;
}

export const TAMANHOS_PAGINA = [10, 25, 50, 100] as const;
export const TAMANHO_PAGINA_PADRAO = 10;

export type FiltrosExtrato = {
  mes: string;
  fila: FilaExtrato;
  busca: string;
  categoriaId: string | null;
  classificacao: ClassificacaoExtrato;
  origem: OrigemExtrato;
  tipoGasto: TipoGastoExtrato;
  papel: PapelExtrato;
  visao?: VisaoExtrato;
  cartoesCiclo?: CartaoCicloExtrato[];
  hoje?: string;
};

type OrigemNomeada = { id: string; nome: string };

export function fila_da_query(valor: string | null): FilaExtrato {
  if (valor === "banco" || valor === "manual" || valor === "revisar" || valor === "todas") {
    return valor;
  }
  return "todas";
}

export function classificacao_da_query(valor: string | null): ClassificacaoExtrato {
  if (
    valor === "usuario" ||
    valor === "regra" ||
    valor === "ia" ||
    valor === "sem_classificar"
  ) {
    return valor;
  }
  return "todas";
}

export function origem_da_query(valor: string | null): OrigemExtrato {
  if (!valor) return { tipo: "todas" };
  if (valor === "contas" || valor === "cartoes") return { tipo: valor };
  const separador = valor.indexOf(":");
  if (separador <= 0) return { tipo: "todas" };
  const tipo = valor.slice(0, separador);
  const id = valor.slice(separador + 1);
  if ((tipo === "conta" || tipo === "cartao") && id) return { tipo, id };
  return { tipo: "todas" };
}

export function origem_para_query(origem: OrigemExtrato): string | null {
  if (origem.tipo === "todas") return null;
  if (origem.tipo === "contas" || origem.tipo === "cartoes") return origem.tipo;
  return `${origem.tipo}:${origem.id}`;
}

export function origem_aceita_modo_fatura(origem: OrigemExtrato): boolean {
  return origem.tipo === "cartoes" || origem.tipo === "cartao";
}

export function origem_da_visao_fatura(origem: OrigemExtrato): OrigemExtrato {
  return origem_aceita_modo_fatura(origem) ? origem : { tipo: "cartoes" };
}

export function tipo_gasto_da_query(valor: string | null): TipoGastoExtrato {
  if (valor === "pessoal" || valor === "empresa") return valor;
  return "todas";
}

export function tipo_gasto_para_query(tipo: TipoGastoExtrato): string | null {
  return tipo === "todas" ? null : tipo;
}

/** Cockpit: sem param = todos, como o extrato. `todos` na URL também é todos. */
export function tipo_gasto_dashboard_da_query(valor: string | null): TipoGastoExtrato {
  return tipo_gasto_da_query(valor);
}

export function tipo_gasto_dashboard_para_query(tipo: TipoGastoExtrato): string | null {
  return tipo_gasto_para_query(tipo);
}

/** Menu do Cockpit: tira `tipoGasto` da URL e mantém o mês. */
export function search_sem_tipo_gasto(search: string): string {
  const bruto = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(bruto);
  params.delete("tipoGasto");
  const texto = params.toString();
  return texto ? `?${texto}` : "";
}

export function perfil_de_tipo_gasto(tipo: TipoGastoExtrato): "pf" | "pj" | undefined {
  if (tipo === "pessoal") return "pf";
  if (tipo === "empresa") return "pj";
  return undefined;
}

export function papel_da_query(valor: string | null): PapelExtrato {
  if (valor === "gastos" || valor === "pagamentos_fatura") return valor;
  return "todas";
}

export function papel_para_query(papel: PapelExtrato): string | null {
  return papel === "todas" ? null : papel;
}

export function tamanho_pagina_da_query(valor: string | null): number {
  const n = Number(valor);
  if ((TAMANHOS_PAGINA as readonly number[]).includes(n)) return n;
  return TAMANHO_PAGINA_PADRAO;
}

export function nome_origem_movimento(
  movimento: Pick<MovimentoResumo, "contaId" | "cartaoId">,
  contas: OrigemNomeada[],
  cartoes: OrigemNomeada[],
): string {
  if (movimento.contaId) {
    return contas.find((c) => c.id === movimento.contaId)?.nome ?? "Conta";
  }
  if (movimento.cartaoId) {
    return cartoes.find((c) => c.id === movimento.cartaoId)?.nome ?? "Cartão";
  }
  return "Sem origem";
}

export function normalizar_busca(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

export const PREFIXO_APRESENTACAO_PARCELA = "apresentacao:";

export function id_movimento_api(id: string): string {
  return id.startsWith(PREFIXO_APRESENTACAO_PARCELA)
    ? id.slice(PREFIXO_APRESENTACAO_PARCELA.length)
    : id;
}

function valor_compra_da_serie(irmas: MovimentoResumo[]): number {
  for (const irma of irmas) {
    const informado = Number(irma.parcelaCompraValor);
    if (Number.isFinite(informado) && informado > 0) return arredondar(informado);
  }
  let soma = 0;
  for (const irma of irmas) {
    const n = Number(irma.valor);
    if (Number.isFinite(n)) soma += n;
  }
  return arredondar(soma);
}

/** Compra cheia no dia da autorização — não é Fato, não soma.
 * Vale para qualquer cartão. Cada série com `parcelaCompraEm` (Pluggy: `purchaseDate`)
 * vira uma linha; parcela nova do Open Finance entra no próximo carregamento do Extrato.
 */
export function linhas_apresentacao_parcelamento(
  movimentos: MovimentoResumo[],
): MovimentoResumo[] {
  const linhas: MovimentoResumo[] = [];
  for (const irmas of agrupar_series_parcelamento(movimentos)) {
    const ancora = irmas[0];
    if (!ancora) continue;
    const compra = data_iso_parcela(ancora.parcelaCompraEm);
    if (!compra) continue;
    linhas.push({
      ...ancora,
      id: `${PREFIXO_APRESENTACAO_PARCELA}${ancora.id}`,
      valor: valor_compra_da_serie(irmas).toFixed(2),
      valorParcela: ancora.valor,
      dataMovimento: compra,
      ocorridoEmInstante: null,
      parcelaNumero: null,
      apresentacao: true,
    });
  }
  return linhas;
}

export function valor_parcela_da_apresentacao(movimento: MovimentoResumo): number | null {
  if (!movimento.apresentacao) return null;
  const informado = Number(movimento.valorParcela);
  if (Number.isFinite(informado) && informado > 0) return arredondar(informado);
  const vezes = movimento.parcelaTotal;
  const total = Number(movimento.valor);
  if (!vezes || vezes < 2 || !Number.isFinite(total) || total <= 0) return null;
  return arredondar(total / vezes);
}

function parcela_no_dia_da_compra(movimento: MovimentoResumo): boolean {
  if (movimento.apresentacao) return false;
  if (movimento.parcelaTotal == null || movimento.parcelaTotal < 2) return false;
  const compra = data_iso_parcela(movimento.parcelaCompraEm);
  if (!compra) return false;
  return data_iso_parcela(movimento.dataMovimento) === compra;
}

function mesclar_apresentacao(
  reais: MovimentoResumo[],
  apresentacao: MovimentoResumo[],
): MovimentoResumo[] {
  if (apresentacao.length === 0) return reais;
  return [...reais, ...apresentacao].sort((a, b) => {
    const porData = b.dataMovimento.localeCompare(a.dataMovimento);
    if (porData !== 0) return porData;
    if (Boolean(a.apresentacao) !== Boolean(b.apresentacao)) {
      return a.apresentacao ? 1 : -1;
    }
    return a.id.localeCompare(b.id);
  });
}

function movimento_passa_filtros(
  movimento: MovimentoResumo,
  contas: OrigemNomeada[],
  cartoes: OrigemNomeada[],
  filtros: FiltrosExtrato,
  contexto: {
    termo: string;
    fechamentoPorCartao: ReadonlyMap<string, number>;
    vencimentoPorCartao: ReadonlyMap<string, number>;
    hoje: string;
    pagamentos: ReturnType<typeof pagamentos_ciclo_de>;
  },
): boolean {
  if (movimento.status === "cancelado") return false;
  if (movimento.ignoradoEmRelatorio) {
    if (filtros.visao === "faturas" || movimento.possivelRepetido) return false;
  }
  if (filtros.visao === "faturas") {
    const fechamento = movimento.cartaoId
      ? contexto.fechamentoPorCartao.get(movimento.cartaoId)
      : undefined;
    const vencimento = movimento.cartaoId
      ? contexto.vencimentoPorCartao.get(movimento.cartaoId)
      : undefined;
    if (
      !na_fatura_do_recorte(movimento, {
        mes: filtros.mes,
        hoje: contexto.hoje,
        fechamento,
        vencimento,
        pagamentos: contexto.pagamentos,
        eixo: "vencimento",
      })
    ) {
      return false;
    }
  } else if (!movimento.dataMovimento.startsWith(`${filtros.mes}-`)) {
    return false;
  }
  if (filtros.fila === "banco" && movimento.fonte !== "open_finance") return false;
  if (filtros.fila === "manual" && movimento.fonte === "open_finance") return false;
  if (filtros.fila === "revisar" && !precisa_revisao(movimento)) return false;

  if (filtros.origem.tipo === "contas" && !movimento.contaId) return false;
  if (filtros.origem.tipo === "cartoes" && !movimento.cartaoId) return false;
  if (filtros.origem.tipo === "conta" && movimento.contaId !== filtros.origem.id) return false;
  if (filtros.origem.tipo === "cartao" && movimento.cartaoId !== filtros.origem.id) {
    return false;
  }

  if (filtros.categoriaId && movimento.categoriaId !== filtros.categoriaId) return false;

  if (filtros.classificacao === "sem_classificar") {
    if (!eh_nao_classificado(movimento.categoriaNome)) return false;
  } else if (
    filtros.classificacao !== "todas" &&
    movimento.classificadoPor !== filtros.classificacao
  ) {
    return false;
  }

  if (filtros.tipoGasto === "pessoal" && movimento.tipoGasto !== "pf") return false;
  if (filtros.tipoGasto === "empresa" && movimento.tipoGasto !== "pj") return false;

  if (filtros.papel === "gastos" && movimento.papel === "pagamento_fatura") return false;
  if (filtros.papel === "pagamentos_fatura" && movimento.papel !== "pagamento_fatura") {
    return false;
  }

  if (contexto.termo) {
    const origem = nome_origem_movimento(movimento, contas, cartoes);
    const haystack = normalizar_busca(
      `${movimento.descricao} ${movimento.descricaoFonte} ${origem}`,
    );
    if (!haystack.includes(contexto.termo)) return false;
  }

  return true;
}

export function filtrar_extrato(
  movimentos: MovimentoResumo[],
  contas: OrigemNomeada[],
  cartoes: OrigemNomeada[],
  filtros: FiltrosExtrato,
): MovimentoResumo[] {
  const termo = normalizar_busca(filtros.busca);
  const fechamentoPorCartao = mapa_fechamento_cartoes(filtros.cartoesCiclo ?? []);
  const vencimentoPorCartao = mapa_vencimento_cartoes(filtros.cartoesCiclo ?? []);
  const hoje = filtros.hoje ?? hojeISO();
  const pagamentos = pagamentos_ciclo_de(movimentos);
  const contexto = { termo, fechamentoPorCartao, vencimentoPorCartao, hoje, pagamentos };
  const filtrados = movimentos.filter((movimento) =>
    movimento_passa_filtros(movimento, contas, cartoes, filtros, contexto),
  );
  if (filtros.visao === "faturas") return filtrados;

  const semChoque = filtrados.filter((movimento) => !parcela_no_dia_da_compra(movimento));
  const apresentacao = linhas_apresentacao_parcelamento(movimentos).filter((linha) =>
    movimento_passa_filtros(linha, contas, cartoes, filtros, contexto),
  );
  return mesclar_apresentacao(semChoque, apresentacao);
}

export type ParcelaIrmaExtrato = {
  id: string;
  descricao: string;
  valor: string;
  status: MovimentoResumo["status"];
  dataMovimento: string;
  parcelaNumero: number | null;
  parcelaTotal: number | null;
};

/** Irmãs da série a partir da lista já carregada no Extrato (sem round-trip). */
export function parcelas_irmas_no_extrato(
  ancora: MovimentoResumo,
  movimentos: MovimentoResumo[],
): ParcelaIrmaExtrato[] {
  return irmas_da_serie(
    ancora,
    movimentos.filter((item) => !item.apresentacao),
  ).map((irma) => ({
    id: irma.id,
    descricao: irma.descricao,
    valor: irma.valor,
    status: irma.status,
    dataMovimento: irma.dataMovimento,
    parcelaNumero: irma.parcelaNumero,
    parcelaTotal: irma.parcelaTotal,
  }));
}

/** Âncora real + parcelas da compra — classificar a linha de apresentação atualiza todas. */
export function ids_classificacao_da_serie(
  movimento: MovimentoResumo,
  movimentos: MovimentoResumo[],
): string[] {
  const realId = id_movimento_api(movimento.id);
  const ancora = { ...movimento, id: realId, apresentacao: false };
  return [...new Set([realId, ...parcelas_irmas_no_extrato(ancora, movimentos).map((irma) => irma.id)])];
}

function eh_entrada_extrato(tipo: string): boolean {
  return tipo === "receita" || tipo === "reembolso" || tipo === "estorno" || tipo === "aporte";
}

export type ResumoExtrato = {
  entradas: number;
  saidas: number;
  entradasQuantidade: number;
  saidasQuantidade: number;
  resultado: number;
  revisarQuantidade: number;
  revisarTotal: number;
  proximaFatura: number;
};

/** Totais do recorte já filtrado, excluindo cancelados e linhas de apresentação. */
export function resumir_extrato(
  movimentos: MovimentoResumo[],
  incluirPagamentosFatura = false,
): ResumoExtrato {
  let entradas = 0;
  let saidas = 0;
  let entradasQuantidade = 0;
  let saidasQuantidade = 0;
  let revisarQuantidade = 0;
  let revisarTotal = 0;
  for (const movimento of movimentos) {
    if (movimento.status === "cancelado") continue;
    if (movimento.apresentacao) continue;
    const valor = Number(movimento.valor);
    const seguro = Number.isFinite(valor) ? valor : 0;
    if (
      incluirPagamentosFatura ||
      (movimento.papel !== "pagamento_fatura" &&
        !eh_credito_quitacao_no_cartao(movimento.descricaoFonte ?? movimento.descricao))
    ) {
      if (eh_entrada_extrato(movimento.tipo)) {
        entradas += seguro;
        entradasQuantidade += 1;
      } else {
        saidas += seguro;
        saidasQuantidade += 1;
      }
    }
    if (precisa_revisao(movimento)) {
      revisarQuantidade += 1;
      revisarTotal += seguro;
    }
  }
  return {
    entradas,
    saidas,
    entradasQuantidade,
    saidasQuantidade,
    resultado: entradas - saidas,
    revisarQuantidade,
    revisarTotal,
    proximaFatura: 0,
  };
}

export type GrupoFaturaExtrato = {
  cartaoId: string;
  cartaoNome: string;
  intervalo: string;
  total: number;
  movimentos: MovimentoResumo[];
  totalOficial?: number | null;
  ajuste?: number | null;
};

export type FaturaOficialExtrato = { cartaoId: string; competencia: string; total: number };

function intervalo_grupo_cartao(
  cartao: { fechamento?: number | null; vencimento?: number | null } | undefined,
  mes: string,
): string {
  if (cartao?.fechamento == null || cartao.fechamento < 1) return "";
  const competencia = competencia_alvo_do_modo_fatura({
    mes,
    fechamento: cartao.fechamento,
    vencimento: cartao.vencimento,
  });
  const ciclo = intervalo_ciclo_fatura(competencia, cartao.fechamento);
  const intervalo = formatar_intervalo_ciclo(ciclo.inicio, ciclo.fim);
  if (cartao.vencimento == null || cartao.vencimento < 1) return intervalo;
  const vence = data_vencimento_do_ciclo(competencia, cartao.fechamento, cartao.vencimento);
  return `${intervalo} · vence ${formatar_data_curta(vence)}`;
}

export function agrupar_faturas_por_cartao(
  movimentos: MovimentoResumo[],
  cartoes: Array<{
    id: string;
    nome: string;
    fechamento?: number | null;
    vencimento?: number | null;
  }>,
  mes: string,
  _hoje = hojeISO(),
  oficiais: FaturaOficialExtrato[] = [],
  cobrancas: MovimentoResumo[] = [],
): GrupoFaturaExtrato[] {
  const mapa = new Map<string, GrupoFaturaExtrato>();
  for (const movimento of movimentos) {
    if (!movimento.cartaoId) continue;
    if (movimento.apresentacao) continue;
    const cartao = cartoes.find((item) => item.id === movimento.cartaoId);
    const grupo = mapa.get(movimento.cartaoId) ?? {
      cartaoId: movimento.cartaoId,
      cartaoNome: cartao?.nome ?? "Cartão",
      intervalo: intervalo_grupo_cartao(cartao, mes),
      total: 0,
      movimentos: [],
    };
    grupo.movimentos.push(movimento);
    grupo.total += valor_na_fatura(movimento);
    mapa.set(movimento.cartaoId, grupo);
  }
  for (const grupo of mapa.values()) {
    const cartao = cartoes.find((item) => item.id === grupo.cartaoId);
    const competenciaFecha =
      cartao?.fechamento != null && cartao.fechamento >= 1
        ? competencia_alvo_do_modo_fatura({
          mes,
          fechamento: cartao.fechamento,
          vencimento: cartao.vencimento,
        })
        : mes;
    const oficial =
      oficiais.find(
        (item) => item.cartaoId === grupo.cartaoId && item.competencia === competenciaFecha,
      ) ??
      oficiais.find((item) => item.cartaoId === grupo.cartaoId && item.competencia === mes);
    const pix =
      cartao?.fechamento != null &&
        cartao.fechamento >= 1 &&
        cartao.vencimento != null &&
        cartao.vencimento >= 1
        ? soma_cobrada_do_vencimento(
          cobrancas,
          grupo.cartaoId,
          mes,
          cartao.fechamento,
          cartao.vencimento,
        )
        : 0;
    if (oficial != null && Number.isFinite(oficial.total)) {
      const aplicado = aplicar_total_oficial(grupo.total, oficial.total);
      grupo.total = aplicado.total;
      grupo.totalOficial = aplicado.totalOficial;
      grupo.ajuste = aplicado.ajuste;
    } else {
      if (pix > 0) grupo.total = pix;
      grupo.totalOficial = null;
      grupo.ajuste = null;
    }
  }
  return [...mapa.values()].sort((a, b) => a.cartaoNome.localeCompare(b.cartaoNome, "pt-BR"));
}

/** Card Saídas no Modo fatura: soma dos totais cobrados dos grupos. */
export function saidas_dos_grupos_fatura(grupos: GrupoFaturaExtrato[]): number {
  return arredondar(grupos.reduce((soma, grupo) => soma + grupo.total, 0));
}

export function quantidade_filtros_drawer(
  filtros: Pick<FiltrosExtrato, "categoriaId" | "classificacao" | "papel" | "fila">,
): number {
  let n = 0;
  if (filtros.categoriaId) n += 1;
  if (filtros.classificacao !== "todas") n += 1;
  if (filtros.papel !== "todas") n += 1;
  if (filtros.fila !== "todas") n += 1;
  return n;
}

export type PaginaExtrato<T> = {
  itens: T[];
  pagina: number;
  paginas: number;
  total: number;
  de: number;
  ate: number;
  porPagina: number;
};

export function paginar<T>(itens: T[], pagina: number, porPagina: number): PaginaExtrato<T> {
  const total = itens.length;
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const paginaAtual = Math.min(Math.max(1, pagina), paginas);
  const inicio = total === 0 ? 0 : (paginaAtual - 1) * porPagina;
  const fatia = itens.slice(inicio, inicio + porPagina);
  return {
    itens: fatia,
    pagina: paginaAtual,
    paginas,
    total,
    de: total === 0 ? 0 : inicio + 1,
    ate: inicio + fatia.length,
    porPagina,
  };
}

/** Ordena categorias pelo uso nos movimentos já carregados (workspace ativo). */
export function ordenar_categorias_por_uso<T extends { id: string; nome: string }>(
  categorias: T[],
  movimentos: Array<Pick<MovimentoResumo, "categoriaId" | "status">>,
): T[] {
  const uso = new Map<string, number>();
  for (const movimento of movimentos) {
    if (movimento.status === "cancelado") continue;
    uso.set(movimento.categoriaId, (uso.get(movimento.categoriaId) ?? 0) + 1);
  }
  return [...categorias].sort((a, b) => {
    const da = uso.get(a.id) ?? 0;
    const db = uso.get(b.id) ?? 0;
    if (db !== da) return db - da;
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
}

/** Categorias que de fato aparecem no recorte — para o filtro do extrato, não o catálogo inteiro. */
export function categorias_com_lancamentos<T extends { id: string; nome: string }>(
  categorias: T[],
  movimentos: Array<Pick<MovimentoResumo, "categoriaId" | "status">>,
): T[] {
  const usadas = new Set<string>();
  for (const movimento of movimentos) {
    if (movimento.status === "cancelado") continue;
    if (movimento.categoriaId) usadas.add(movimento.categoriaId);
  }
  return ordenar_categorias_por_uso(
    categorias.filter((categoria) => usadas.has(categoria.id)),
    movimentos,
  );
}
