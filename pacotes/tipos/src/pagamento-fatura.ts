import {
  adicionarMeses,
  deISOParaData,
  dias_calendario_entre,
  paraDataISO,
  somar_meses_calendario,
} from "./datas";
import { arredondar } from "./dinheiro";

/**
 * Heurística de sugestão de pagamento de fatura (Conhecimento).
 * Nunca aplica sozinha: a pessoa confirma no Extrato.
 */

const PADROES_DESCRICAO = [
  /\bfatura\b/i,
  /\b(?:pagto|pgto|pagamento)\b.{0,32}\b(?:fatura|cart[aã]o)\b/i,
  /\b(?:fatura|cart[aã]o)\b.{0,32}\b(?:pagto|pgto|pagamento)\b/i,
];

const TOLERANCIA_VALOR_REAIS = 1;
const JANELA_VENCIMENTO_DIAS = 7;

export type PapelConhecimentoSugestao = "gasto" | "pagamento_fatura";

export type MovimentoSugestaoFatura = {
  id: string;
  descricao: string;
  descricaoFonte: string;
  valor: string;
  tipo: string;
  dataMovimento: string;
  contaId: string | null;
  cartaoId: string | null;
  papel?: PapelConhecimentoSugestao | null;
  ignoradoEmRelatorio?: boolean;
  competenciaFatura?: string | null;
};

export type CartaoSugestaoFatura = {
  id: string;
  nome: string;
  contaId?: string | null;
  vencimento: number;
  fechamento?: number;
};

export type SugestaoPagamentoFatura = {
  cartaoId: string;
  cartaoNome: string;
  competencia: string;
  motivo: "descricao" | "valor_ciclo" | "par_credito";
};

export function descricao_parece_pagamento_fatura(...textos: Array<string | null | undefined>): boolean {
  const junto = textos.filter(Boolean).join(" ");
  if (!junto.trim()) return false;
  return PADROES_DESCRICAO.some((padrao) => padrao.test(junto));
}

/**
 * Crédito de quitação no extrato do cartão.
 * Nubank: "Pagamento recebido". Itaú/Azul: "Pagamento PIX" (além do débito na conta).
 * A Open Finance manda duas linhas para o mesmo pagamento — pendente e fatura.
 * Não usa a heurística acima: esses textos não devem marcar fatura sozinhos na conta.
 */
export function eh_credito_quitacao_no_cartao(descricao: string): boolean {
  return /^pagamento (recebido|pix)$/i.test(descricao.trim());
}

/** Débito na conta (Pix/TED da quitação) ou crédito de quitação no extrato do cartão. */
export function linha_aceita_pagamento_fatura(movimento: {
  tipo: string;
  contaId: string | null;
  cartaoId: string | null;
}): boolean {
  if (movimento.cartaoId && (movimento.tipo === "receita" || movimento.tipo === "estorno")) {
    return true;
  }
  if (movimento.contaId && (movimento.tipo === "despesa" || movimento.tipo === "retirada")) {
    return true;
  }
  return false;
}

/**
 * Heurística do extrato (sugerir pagamento). Não decide ciclo de parcela —
 * isso é `ciclo_do_movimento` + `data_vencimento_do_ciclo`.
 */
export function competencia_vencimento_proximo(dataISO: string, diaVencimento: number): string {
  const partes = dataISO.slice(0, 10).split("-").map(Number);
  const ano = partes[0];
  const mes = partes[1];
  const dia = partes[2];
  if (!ano || !mes || !dia) return dataISO.slice(0, 7);

  const vencimento = Math.min(Math.max(1, diaVencimento), 28);
  const data = Date.UTC(ano, mes - 1, dia);
  const candidatos = [
    Date.UTC(ano, mes - 2, vencimento),
    Date.UTC(ano, mes - 1, vencimento),
    Date.UTC(ano, mes, vencimento),
  ];

  let melhor = candidatos[1] ?? data;
  let menor = Number.POSITIVE_INFINITY;
  for (const candidato of candidatos) {
    const dist = Math.abs(candidato - data);
    if (dist < menor) {
      menor = dist;
      melhor = candidato;
    }
  }

  const dataMelhor = new Date(melhor);
  const y = dataMelhor.getUTCFullYear();
  const m = String(dataMelhor.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function data_proxima_do_vencimento(
  dataISO: string,
  diaVencimento: number,
  janelaDias = JANELA_VENCIMENTO_DIAS,
): boolean {
  const partes = dataISO.slice(0, 10).split("-").map(Number);
  const ano = partes[0];
  const mes = partes[1];
  const dia = partes[2];
  if (!ano || !mes || !dia) return false;
  const vencimento = Math.min(Math.max(1, diaVencimento), 28);
  const data = Date.UTC(ano, mes - 1, dia);
  const candidatos = [
    Date.UTC(ano, mes - 2, vencimento),
    Date.UTC(ano, mes - 1, vencimento),
    Date.UTC(ano, mes, vencimento),
  ];
  const janelaMs = janelaDias * 24 * 60 * 60 * 1000;
  return candidatos.some((candidato) => Math.abs(candidato - data) <= janelaMs);
}

/** Dia de fechamento naquele mês (1…último dia). Fecha 30 em fevereiro vira 28/29. */
export function dia_fechamento_no_mes(ano: number, mes: number, fechamento: number): number {
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return Math.min(Math.max(1, fechamento), ultimo);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function mes_seguinte_competencia(competencia: string): string {
  return somar_meses_calendario(`${competencia}-01`, 1).slice(0, 7);
}

function mes_anterior_competencia(competencia: string): string {
  return somar_meses_calendario(`${competencia}-01`, -1).slice(0, 7);
}

/** Ciclo cujo fechamento cai no mês `competencia` (dia seguinte ao fecha anterior → fecha). */
export function intervalo_ciclo_fatura(
  competencia: string,
  fechamento: number,
): { inicio: string; fim: string } {
  const [anoStr, mesStr] = competencia.split("-");
  const ano = Number(anoStr);
  const mes = Number(mesStr);
  const diaFim = dia_fechamento_no_mes(ano, mes, fechamento);
  const fim = `${anoStr}-${pad2(mes)}-${pad2(diaFim)}`;
  const prev = new Date(Date.UTC(ano, mes - 2, 1));
  const prevAno = prev.getUTCFullYear();
  const prevMes = prev.getUTCMonth() + 1;
  const diaFechaPrev = dia_fechamento_no_mes(prevAno, prevMes, fechamento);
  const inicio = new Date(Date.UTC(prevAno, prevMes - 1, diaFechaPrev + 1));
  return { inicio: iso_utc(inicio), fim };
}

/** Ciclo aberto em `hoje`: se passou o fecha, o seguinte. */
export function ciclo_aberto_em(hoje: string, fechamento: number): string {
  return competencia_ciclo_da_data(hoje, fechamento);
}

/**
 * Competência que o Cockpit usa no cartão: no mês civil de hoje, a fatura
 * aberta; em mês passado/futuro, o ciclo que fecha naquele mês.
 */
export function mes_gasto_do_cartao(entrada: {
  mesSelecionado: string;
  hoje: string;
  fechamento: number;
}): string {
  if (entrada.mesSelecionado !== entrada.hoje.slice(0, 7)) return entrada.mesSelecionado;
  return ciclo_aberto_em(entrada.hoje, entrada.fechamento);
}

/** Competência cuja fatura inclui a compra nesta data (inverso de `intervalo_ciclo_fatura`). */
export function competencia_ciclo_da_data(dataISO: string, fechamento: number): string {
  const [anoStr, mesStr, diaStr] = dataISO.slice(0, 10).split("-");
  const ano = Number(anoStr);
  const mes = Number(mesStr);
  const dia = Number(diaStr);
  if (!ano || !mes || !dia) return dataISO.slice(0, 7);
  const diaFecha = dia_fechamento_no_mes(ano, mes, fechamento);
  if (dia <= diaFecha) {
    return `${anoStr}-${pad2(mes)}`;
  }
  return mes_seguinte_competencia(`${anoStr}-${pad2(mes)}`);
}

/** Vencimento da fatura que fechou no mês `competencia`. */
export function data_vencimento_do_ciclo(
  competencia: string,
  fechamento: number,
  vencimento: number,
): string {
  const [anoStr, mesStr] = competencia.split("-");
  const ano = Number(anoStr);
  const mes = Number(mesStr);
  if (vencimento < fechamento) {
    const proximo = mes_seguinte_competencia(competencia);
    const [anoP, mesP] = proximo.split("-").map(Number);
    const dia = dia_fechamento_no_mes(anoP!, mesP!, vencimento);
    return `${proximo}-${pad2(dia)}`;
  }
  const dia = dia_fechamento_no_mes(ano, mes, vencimento);
  return `${competencia}-${pad2(dia)}`;
}

/**
 * Ciclo cuja fatura vence no mês civil. Não escolhe a linha aberta dos Próximos
 * (aberto = ciclo que fecha no mês da tela + `data_vencimento_do_ciclo`).
 */
export function competencia_ciclo_vencendo_em(
  mesAgenda: string,
  fechamento: number,
  vencimento: number,
): string {
  if (vencimento < fechamento) return mes_anterior_competencia(mesAgenda);
  return mesAgenda;
}

/**
 * Ciclo do Modo fatura: a fatura que **vence** no mês da tela.
 * Sem dia de vencimento, o mês é o do fecha (mesmo recorte histórico).
 */
export function competencia_alvo_do_modo_fatura(entrada: {
  mes: string;
  fechamento: number;
  vencimento?: number | null;
}): string {
  if (entrada.vencimento != null && entrada.vencimento >= 1) {
    return competencia_ciclo_vencendo_em(entrada.mes, entrada.fechamento, entrada.vencimento);
  }
  return entrada.mes;
}

/**
 * Competência que o pagamento quita: se cai perto do vencimento do ciclo
 * anterior, é resto/liquidação daquele; no dia do fecha, quita o ciclo que
 * fechou (ignora tag do ciclo recém-aberto); tag de ciclo anterior prevalece.
 */
export function competencia_quitacao_fatura(
  dataISO: string,
  fechamento: number,
  vencimento: number,
  competenciaFatura?: string | null,
): string {
  const data = dataISO.slice(0, 10);
  const ciclo = competencia_ciclo_da_data(data, fechamento);
  const anterior = mes_anterior_competencia(ciclo);
  const vencAnterior = data_vencimento_do_ciclo(anterior, fechamento, vencimento);
  if (dias_calendario_entre(data, vencAnterior) <= JANELA_VENCIMENTO_DIAS) {
    return anterior;
  }
  const { fim } = intervalo_ciclo_fatura(ciclo, fechamento);
  if (data <= fim) {
    if (competenciaFatura && /^\d{4}-\d{2}$/.test(competenciaFatura) && competenciaFatura < ciclo) {
      return competenciaFatura;
    }
    return ciclo;
  }
  if (competenciaFatura && /^\d{4}-\d{2}$/.test(competenciaFatura)) return competenciaFatura;
  return ciclo;
}

/**
 * Mês que o modal grava (`Fatura que vence em`): vencimento do ciclo que o
 * Pix quitou. `competencia_quitacao_fatura` devolve o mês do fecha.
 */
export function competencia_vencimento_da_quitacao(
  dataISO: string,
  fechamento: number,
  vencimento: number,
  competenciaFatura?: string | null,
): string {
  const ciclo = competencia_quitacao_fatura(dataISO, fechamento, vencimento, competenciaFatura);
  return data_vencimento_do_ciclo(ciclo, fechamento, vencimento).slice(0, 7);
}

/** Crédito OF de quitação no cartão: já nasce como pagamento da fatura. */
export function conhecimento_inicial_credito_quitacao(entrada: {
  tipo: string;
  descricaoFonte: string;
  cartaoId?: string | null;
  dataMovimento: string;
  fechamento?: number | null;
  vencimento?: number | null;
}): {
  papel: "pagamento_fatura";
  cartaoFaturaId: string;
  competenciaFatura: string;
  ignoradoEmRelatorio: true;
} | null {
  if (!entrada.cartaoId) return null;
  if (entrada.tipo !== "receita" && entrada.tipo !== "estorno") return null;
  if (!eh_credito_quitacao_no_cartao(entrada.descricaoFonte)) return null;
  if (entrada.fechamento == null || entrada.fechamento < 1) return null;
  if (entrada.vencimento == null || entrada.vencimento < 1) return null;
  return {
    papel: "pagamento_fatura",
    cartaoFaturaId: entrada.cartaoId,
    competenciaFatura: competencia_vencimento_da_quitacao(
      entrada.dataMovimento,
      entrada.fechamento,
      entrada.vencimento,
    ),
    ignoradoEmRelatorio: true,
  };
}

const MESES_CURTOS = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
] as const;

const MESES_EXTENSO = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

function indice_mes(competencia: string): number {
  const mes = Number(competencia.slice(5, 7));
  return Number.isFinite(mes) ? mes - 1 : -1;
}

export function rotulo_mes_curto(competencia: string): string {
  return MESES_CURTOS[indice_mes(competencia)] ?? competencia.slice(5, 7);
}

export function nome_mes_extenso(competencia: string): string {
  return MESES_EXTENSO[indice_mes(competencia)] ?? competencia;
}

export type PagamentoCiclo = {
  cartaoId?: string | null;
  dataMovimento: string;
  competenciaFatura?: string | null;
  papel?: string | null;
};

export type ExtraCicloMovimento = {
  vencimento?: number | null;
  parcelaNumero?: number | null;
  status?: string | null;
  pagamentos?: PagamentoCiclo[];
};

/**
 * Parcela prevista datada no vencimento depois do fecha *no mesmo mês*
 * (vence > fecha) volta ao ciclo que acabou de fechar.
 * Se o vencimento é no mês seguinte (vence < fecha), a data já cai no
 * ciclo aberto — puxar para o fechado empilha duas parcelas na mesma fatura.
 */
function ciclo_da_parcela_prevista(
  data: string,
  ciclo: string,
  fechamento: number,
  vencimento: number,
): string {
  if (vencimento < fechamento) return ciclo;
  const candidatos = [
    mes_anterior_competencia(ciclo),
    ciclo,
    mes_seguinte_competencia(ciclo),
  ];
  for (const competencia of candidatos) {
    const venc = data_vencimento_do_ciclo(competencia, fechamento, vencimento);
    if (dias_calendario_entre(data, venc) <= JANELA_VENCIMENTO_DIAS) {
      return competencia;
    }
  }
  return ciclo;
}

function aplicar_antecipacao(
  data: string,
  mes: string,
  cartaoId: string,
  fechamento: number,
  vencimento: number | null | undefined,
  pagamentos: PagamentoCiclo[] | undefined,
): string {
  if (!pagamentos?.length || vencimento == null || vencimento < 1) return mes;
  for (const pag of pagamentos) {
    if (pag.papel != null && pag.papel !== "pagamento_fatura") continue;
    if (pag.cartaoId !== cartaoId) continue;
    const dataPag = pag.dataMovimento.slice(0, 10);
    const quitacao = competencia_quitacao_fatura(
      dataPag,
      fechamento,
      vencimento,
      pag.competenciaFatura,
    );
    const { fim } = intervalo_ciclo_fatura(quitacao, fechamento);
    if (dataPag >= fim) continue;
    if (data >= dataPag && mes === quitacao) return mes_seguinte_competencia(quitacao);
  }
  return mes;
}

/**
 * Ciclo da linha: intervalo do fechamento. Parcela prevista no vencimento
 * depois do fecha no mesmo mês volta ao ciclo que fechou; se o vence é no
 * mês seguinte, fica no ciclo aberto. Antecipação empurra ao aberto.
 * Conta (sem cartão) = mês civil.
 */
export function ciclo_do_movimento(
  dataMovimento: string,
  cartaoId: string | null | undefined,
  fechamento: number | null | undefined,
  extra?: ExtraCicloMovimento,
): string {
  const data = String(dataMovimento).slice(0, 10);
  const mesCivil = data.slice(0, 7);
  if (!cartaoId || fechamento == null || fechamento < 1) return mesCivil;
  const ciclo = competencia_ciclo_da_data(data, fechamento);
  const vencimento = extra?.vencimento;
  const parcela = extra?.parcelaNumero;
  let mes = ciclo;
  if (
    parcela != null &&
    parcela >= 1 &&
    vencimento != null &&
    vencimento >= 1 &&
    extra?.status !== "realizado" &&
    extra?.status !== "cancelado"
  ) {
    mes = ciclo_da_parcela_prevista(data, ciclo, fechamento, vencimento);
  }
  return aplicar_antecipacao(data, mes, cartaoId, fechamento, vencimento, extra?.pagamentos);
}

/** @deprecated Use `ciclo_do_movimento`. */
export function mes_resultado_do_movimento(
  dataMovimento: string,
  cartaoId: string | null | undefined,
  fechamento: number | null | undefined,
  extra?: ExtraCicloMovimento,
): string {
  return ciclo_do_movimento(dataMovimento, cartaoId, fechamento, extra);
}

export function mapa_fechamento_cartoes(
  cartoes: Array<{ id: string; fechamento?: number | null }>,
): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const cartao of cartoes) {
    if (cartao.fechamento != null && cartao.fechamento >= 1) {
      mapa.set(cartao.id, cartao.fechamento);
    }
  }
  return mapa;
}

export function mapa_vencimento_cartoes(
  cartoes: Array<{ id: string; vencimento?: number | null }>,
): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const cartao of cartoes) {
    if (cartao.vencimento != null && cartao.vencimento >= 1) {
      mapa.set(cartao.id, cartao.vencimento);
    }
  }
  return mapa;
}

const CREDITOS_DA_FATURA = new Set(["receita", "reembolso", "estorno"]);

function textos_do_movimento(movimento: {
  descricao?: string | null;
  descricaoFonte?: string | null;
}): string[] {
  return [movimento.descricao, movimento.descricaoFonte].filter(
    (texto): texto is string => Boolean(texto && texto.trim()),
  );
}

/** Quitação no extrato do cartão — não é gasto nem abatimento do ciclo. */
function eh_quitacao_da_fatura(movimento: {
  papel?: string | null;
  descricao?: string | null;
  descricaoFonte?: string | null;
}): boolean {
  if (movimento.papel === "pagamento_fatura") return true;
  return textos_do_movimento(movimento).some((texto) => eh_credito_quitacao_no_cartao(texto));
}

/**
 * Linha que a fatura lista: despesa ou crédito no cartão.
 * `Pagamento recebido` / `pagamento_fatura` ficam de fora.
 */
export function eh_linha_da_fatura(movimento: {
  cartaoId?: string | null;
  tipo?: string | null;
  papel?: string | null;
  status?: string | null;
  ignoradoEmRelatorio?: boolean;
  descricao?: string | null;
  descricaoFonte?: string | null;
}): boolean {
  if (!movimento.cartaoId) return false;
  if (movimento.status === "cancelado") return false;
  if (movimento.ignoradoEmRelatorio) return false;
  if (eh_quitacao_da_fatura(movimento)) return false;
  if (movimento.tipo == null || movimento.tipo === "despesa") return true;
  return CREDITOS_DA_FATURA.has(movimento.tipo);
}

/** Compra que o card de cartões soma: despesa no cartão, não quitação, não ignorada. */
export function eh_gasto_da_fatura(movimento: {
  cartaoId?: string | null;
  tipo?: string | null;
  papel?: string | null;
  status?: string | null;
  ignoradoEmRelatorio?: boolean;
  descricao?: string | null;
  descricaoFonte?: string | null;
}): boolean {
  if (movimento.tipo != null && movimento.tipo !== "despesa") return false;
  return eh_linha_da_fatura(movimento);
}

/** Despesa soma; crédito do cartão (estorno, atraso) abate. */
export function valor_na_fatura(movimento: {
  tipo?: string | null;
  valor: string | number;
}): number {
  const valor = Number(movimento.valor);
  const seguro = Number.isFinite(valor) ? valor : 0;
  if (movimento.tipo != null && CREDITOS_DA_FATURA.has(movimento.tipo)) return -seguro;
  return seguro;
}

/**
 * Fatura fechada: o total do banco prevalece. Aberto (sem oficial) fica no líquido.
 * `ajuste` = oficial − líquido — residual que as linhas ainda não explicam.
 */
export function aplicar_total_oficial(
  liquido: number,
  oficial?: number | null,
): { total: number; totalOficial: number | null; ajuste: number | null } {
  const soma = arredondar(liquido);
  if (oficial == null || !Number.isFinite(oficial)) {
    return { total: soma, totalOficial: null, ajuste: null };
  }
  const banco = arredondar(oficial);
  return { total: banco, totalOficial: banco, ajuste: arredondar(banco - soma) };
}

export type MovimentoCobrancaFatura = {
  cartaoId?: string | null;
  cartaoFaturaId?: string | null;
  competenciaFatura?: string | null;
  dataMovimento: string;
  valor: string | number;
  papel?: string | null;
  tipo?: string | null;
  status?: string | null;
  descricao?: string | null;
  descricaoFonte?: string | null;
};

function cartao_do_pagamento(movimento: MovimentoCobrancaFatura): string | null {
  return movimento.cartaoFaturaId ?? movimento.cartaoId ?? null;
}

function competencia_cobranca_casa(
  movimento: MovimentoCobrancaFatura,
  mesVencimento: string,
  fechamento: number,
  vencimento: number,
): boolean {
  const tag = movimento.competenciaFatura;
  if (tag && /^\d{4}-\d{2}$/.test(tag)) {
    if (tag === mesVencimento) return true;
    return tag === competencia_ciclo_vencendo_em(mesVencimento, fechamento, vencimento);
  }
  return (
    competencia_vencimento_da_quitacao(movimento.dataMovimento, fechamento, vencimento) ===
    mesVencimento
  );
}

/**
 * Pix/crédito que quitou a fatura daquele vencimento — vira o total cobrado
 * quando ainda não há `fatura_oficial`.
 */
export function soma_cobrada_do_vencimento(
  movimentos: MovimentoCobrancaFatura[],
  cartaoId: string,
  mesVencimento: string,
  fechamento: number,
  vencimento: number,
): number {
  let soma = 0;
  for (const movimento of movimentos) {
    if (movimento.status === "cancelado") continue;
    const doCartao = cartao_do_pagamento(movimento) === cartaoId;
    if (!doCartao) continue;
    const marcado = movimento.papel === "pagamento_fatura";
    const credito =
      Boolean(movimento.cartaoId) &&
      movimento.cartaoId === cartaoId &&
      eh_quitacao_da_fatura(movimento);
    if (!marcado && !credito) continue;
    if (!competencia_cobranca_casa(movimento, mesVencimento, fechamento, vencimento)) continue;
    const n = Number(movimento.valor);
    if (Number.isFinite(n)) soma += n;
  }
  return arredondar(soma);
}

export function pagamentos_ciclo_de(
  movimentos: Array<{
    cartaoId?: string | null;
    dataMovimento: string;
    competenciaFatura?: string | null;
    papel?: string | null;
  }>,
): PagamentoCiclo[] {
  return movimentos
    .filter((movimento) => movimento.papel === "pagamento_fatura")
    .map((movimento) => ({
      cartaoId: movimento.cartaoId,
      dataMovimento: String(movimento.dataMovimento).slice(0, 10),
      competenciaFatura: movimento.competenciaFatura,
      papel: movimento.papel,
    }));
}

/**
 * Compra na fatura do recorte (card Cartões / Extrato Faturas / drawer).
 * `eixo: fechamento` (padrão, Cockpit): mês atual = ciclo aberto; histórico =
 * ciclo que fecha naquele mês. `eixo: vencimento` (Modo fatura): ciclo cuja
 * fatura vence no mês da tela.
 */
export function na_fatura_do_recorte(
  movimento: {
    dataMovimento: string;
    cartaoId?: string | null;
    parcelaNumero?: number | null;
    status?: string | null;
    tipo?: string | null;
    papel?: string | null;
    ignoradoEmRelatorio?: boolean;
    descricao?: string | null;
    descricaoFonte?: string | null;
  },
  entrada: {
    mes: string;
    hoje: string;
    fechamento?: number | null;
    vencimento?: number | null;
    pagamentos?: PagamentoCiclo[];
    eixo?: "fechamento" | "vencimento";
  },
): boolean {
  if (!eh_linha_da_fatura(movimento)) return false;
  const fechamento = entrada.fechamento;
  if (fechamento == null || fechamento < 1) {
    return String(movimento.dataMovimento).startsWith(`${entrada.mes}-`);
  }
  const alvo =
    entrada.eixo === "vencimento"
      ? competencia_alvo_do_modo_fatura({
          mes: entrada.mes,
          fechamento,
          vencimento: entrada.vencimento,
        })
      : mes_gasto_do_cartao({
          mesSelecionado: entrada.mes,
          hoje: entrada.hoje,
          fechamento,
        });
  return (
    ciclo_do_movimento(movimento.dataMovimento, movimento.cartaoId, fechamento, {
      vencimento: entrada.vencimento,
      parcelaNumero: movimento.parcelaNumero,
      status: movimento.status,
      pagamentos: entrada.pagamentos,
    }) === alvo
  );
}

/**
 * Mesma competência do Cockpit: conta no calendário; cartão no ciclo aberto
 * (mês atual) ou o ciclo que fecha no mês da tela (histórico).
 */
export function movimento_no_recorte_do_cockpit(
  movimento: {
    dataMovimento: string;
    cartaoId?: string | null;
    parcelaNumero?: number | null;
    status?: string | null;
  },
  mesSelecionado: string,
  hoje: string,
  fechamentoPorCartao: ReadonlyMap<string, number>,
  vencimentoPorCartao: ReadonlyMap<string, number> = new Map(),
  pagamentos: PagamentoCiclo[] = [],
): boolean {
  if (!movimento.cartaoId) {
    return String(movimento.dataMovimento).startsWith(`${mesSelecionado}-`);
  }
  const fechamento = fechamentoPorCartao.get(movimento.cartaoId);
  if (fechamento == null || fechamento < 1) {
    return String(movimento.dataMovimento).startsWith(`${mesSelecionado}-`);
  }
  const alvo = mes_gasto_do_cartao({
    mesSelecionado,
    hoje,
    fechamento,
  });
  return movimento_no_resultado_do_mes(
    movimento,
    alvo,
    fechamentoPorCartao,
    vencimentoPorCartao,
    pagamentos,
  );
}

export function movimento_no_resultado_do_mes(
  movimento: {
    dataMovimento: string;
    cartaoId?: string | null;
    parcelaNumero?: number | null;
    status?: string | null;
  },
  mes: string,
  fechamentoPorCartao: ReadonlyMap<string, number>,
  vencimentoPorCartao: ReadonlyMap<string, number> = new Map(),
  pagamentos: PagamentoCiclo[] = [],
): boolean {
  const fechamento = movimento.cartaoId ? fechamentoPorCartao.get(movimento.cartaoId) : undefined;
  const vencimento = movimento.cartaoId ? vencimentoPorCartao.get(movimento.cartaoId) : undefined;
  return (
    ciclo_do_movimento(movimento.dataMovimento, movimento.cartaoId, fechamento, {
      vencimento,
      parcelaNumero: movimento.parcelaNumero,
      status: movimento.status,
      pagamentos,
    }) === mes
  );
}

/** Amplia o recorte civil: mês anterior (pós-fechamento) e o seguinte (parcela no vencimento). */
export function periodo_amplo_do_ciclo(
  periodo: { de: string; ate: string },
  mesesAnteriores = 1,
  mesesSeguintes = 1,
): { de: string; ate: string } {
  return {
    de: paraDataISO(adicionarMeses(deISOParaData(periodo.de), -mesesAnteriores)),
    ate: somar_meses_calendario(periodo.ate, mesesSeguintes),
  };
}

export type SeloFaturaCiclo = {
  rotulo: string;
  dica: string;
};

/**
 * Selo do extrato quando a compra é de um mês e a fatura é de outro.
 * Dentro do ciclo (compra e fatura no mesmo mês) não há selo.
 * Crédito de quitação (`Pagamento recebido`) não é compra: não recebe selo.
 */
export function selo_fatura_ciclo(entrada: {
  dataMovimento: string;
  cartaoId?: string | null;
  fechamento?: number | null;
  vencimento?: number | null;
  parcelaNumero?: number | null;
  status?: string | null;
  tipo?: string | null;
  papel?: string | null;
}): SeloFaturaCiclo | null {
  if (entrada.papel === "pagamento_fatura") return null;
  if (entrada.tipo && entrada.tipo !== "despesa" && entrada.tipo !== "retirada") return null;
  if (!entrada.cartaoId) return null;
  if (entrada.fechamento == null || entrada.fechamento < 1) return null;
  const data = String(entrada.dataMovimento).slice(0, 10);
  const mesCompra = data.slice(0, 7);
  const competencia = ciclo_do_movimento(data, entrada.cartaoId, entrada.fechamento, {
    vencimento: entrada.vencimento,
    parcelaNumero: entrada.parcelaNumero,
    status: entrada.status,
  });
  if (competencia === mesCompra) return null;

  const rotulo = `Fatura ${rotulo_mes_curto(competencia)}`;
  const mesNome = nome_mes_extenso(competencia);
  const vencimento =
    entrada.vencimento != null && entrada.vencimento >= 1 ? ` (vence dia ${entrada.vencimento})` : "";
  const dica =
    entrada.status === "previsto"
      ? `Em aberto. Entra na fatura de ${mesNome}${vencimento}.`
      : `Entra na fatura de ${mesNome}${vencimento}.`;
  return { rotulo, dica };
}

export function valores_proximos(a: number, b: number, tolerancia = TOLERANCIA_VALOR_REAIS): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= tolerancia;
}

export function sugerir_pagamento_fatura(
  movimento: MovimentoSugestaoFatura,
  cartoes: CartaoSugestaoFatura[],
  movimentos: MovimentoSugestaoFatura[],
): SugestaoPagamentoFatura | null {
  if (movimento.papel === "pagamento_fatura") return null;
  if (!linha_aceita_pagamento_fatura(movimento)) return null;

  const valor = Number(movimento.valor);
  const textoDescricao = [movimento.descricao, movimento.descricaoFonte].filter(Boolean).join(" ");
  const descricaoCasa = descricao_parece_pagamento_fatura(textoDescricao);

  const candidatos = cartoes_candidatos(movimento, cartoes);
  if (candidatos.length === 0) return null;

  const par = sugestao_par_credito(movimento, valor, candidatos, movimentos);
  if (par) return par;

  const creditoQuitacao = textos_do_movimento(movimento).some((texto) =>
    eh_credito_quitacao_no_cartao(texto),
  );
  if (creditoQuitacao) {
    const alvo = candidatos[0];
    if (alvo) {
      const fechamento = alvo.fechamento ?? alvo.vencimento;
      return {
        cartaoId: alvo.id,
        cartaoNome: alvo.nome,
        competencia: competencia_vencimento_da_quitacao(
          movimento.dataMovimento,
          fechamento,
          alvo.vencimento,
          movimento.competenciaFatura,
        ),
        motivo: "descricao",
      };
    }
  }

  const citado = cartoes.find((cartao) => texto_cita_nome(textoDescricao, cartao.nome));
  if (citado) {
    return {
      cartaoId: citado.id,
      cartaoNome: citado.nome,
      competencia: competencia_vencimento_proximo(movimento.dataMovimento, citado.vencimento),
      motivo: "descricao",
    };
  }

  if (descricaoCasa) {
    const alvo = candidatos[0];
    if (alvo) {
      return {
        cartaoId: alvo.id,
        cartaoNome: alvo.nome,
        competencia: competencia_vencimento_proximo(movimento.dataMovimento, alvo.vencimento),
        motivo: "descricao",
      };
    }
  }

  const paraValorCiclo = movimento.cartaoId ? candidatos : cartoes;
  for (const cartao of paraValorCiclo) {
    const competencia = competencia_vencimento_proximo(movimento.dataMovimento, cartao.vencimento);
    const pertoVencimento = data_proxima_do_vencimento(
      movimento.dataMovimento,
      cartao.vencimento,
    );
    if (!pertoVencimento || !Number.isFinite(valor)) continue;

    const fechamento = cartao.fechamento ?? cartao.vencimento;
    const cicloFecha = competencia_ciclo_vencendo_em(competencia, fechamento, cartao.vencimento);
    const ciclo = intervalo_ciclo_fatura(cicloFecha, fechamento);
    const soma = soma_despesas_ciclo(cartao.id, ciclo, movimentos);
    if (valores_proximos(valor, soma)) {
      return {
        cartaoId: cartao.id,
        cartaoNome: cartao.nome,
        competencia,
        motivo: "valor_ciclo",
      };
    }
  }

  return null;
}

function texto_cita_nome(texto: string, nome: string): boolean {
  const trecho = nome.trim();
  if (trecho.length < 2) return false;
  const escapado = trecho.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escapado, "i").test(texto);
}

function cartoes_candidatos(
  movimento: MovimentoSugestaoFatura,
  cartoes: CartaoSugestaoFatura[],
): CartaoSugestaoFatura[] {
  if (movimento.cartaoId) {
    const proprio = cartoes.find((c) => c.id === movimento.cartaoId);
    return proprio ? [proprio] : [];
  }
  const preferenciais = cartoes.filter((c) => c.contaId && c.contaId === movimento.contaId);
  return preferenciais.length > 0 ? preferenciais : cartoes;
}

function sugestao_par_credito(
  movimento: MovimentoSugestaoFatura,
  valor: number,
  candidatos: CartaoSugestaoFatura[],
  movimentos: MovimentoSugestaoFatura[],
): SugestaoPagamentoFatura | null {
  if (!movimento.cartaoId || (movimento.tipo !== "receita" && movimento.tipo !== "estorno")) {
    return null;
  }
  const mes = movimento.dataMovimento.slice(0, 7);
  const par = movimentos.find(
    (outro) =>
      outro.id !== movimento.id &&
      outro.papel === "pagamento_fatura" &&
      outro.contaId &&
      !outro.cartaoId &&
      outro.dataMovimento.slice(0, 7) === mes &&
      valores_proximos(Number(outro.valor), valor),
  );
  if (!par) return null;
  const cartao = candidatos[0];
  if (!cartao) return null;
  return {
    cartaoId: cartao.id,
    cartaoNome: cartao.nome,
    competencia: par.competenciaFatura ?? mes,
    motivo: "par_credito",
  };
}

function soma_despesas_ciclo(
  cartaoId: string,
  ciclo: { inicio: string; fim: string },
  movimentos: MovimentoSugestaoFatura[],
): number {
  let soma = 0;
  for (const item of movimentos) {
    if (item.cartaoId !== cartaoId) continue;
    if (item.tipo !== "despesa") continue;
    if (item.papel === "pagamento_fatura") continue;
    if (item.ignoradoEmRelatorio) continue;
    if (item.dataMovimento < ciclo.inicio || item.dataMovimento > ciclo.fim) continue;
    const n = Number(item.valor);
    if (Number.isFinite(n)) soma += n;
  }
  return Math.round(soma * 100) / 100;
}

function iso_utc(data: Date): string {
  const y = data.getUTCFullYear();
  const m = String(data.getUTCMonth() + 1).padStart(2, "0");
  const d = String(data.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
