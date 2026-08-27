import { adicionarMeses, deISOParaData, paraDataISO } from "./datas";

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
 * Crédito de quitação no extrato do cartão (Nubank: "Pagamento recebido").
 * A Open Finance manda duas linhas para o mesmo pagamento — pendente e fatura.
 * Não usa a heurística acima: "Pagamento recebido" não deve marcar fatura sozinho.
 */
export function eh_credito_quitacao_no_cartao(descricao: string): boolean {
  return /^pagamento recebido$/i.test(descricao.trim());
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

/** Ciclo cuja fatura vence no mês `competencia` (fechamento do mês até fechamento do anterior + 1). */
export function intervalo_ciclo_fatura(
  competencia: string,
  fechamento: number,
): { inicio: string; fim: string } {
  const [anoStr, mesStr] = competencia.split("-");
  const ano = Number(anoStr);
  const mes = Number(mesStr);
  const diaFecha = Math.min(Math.max(1, fechamento), 28);
  const fim = new Date(Date.UTC(ano, mes - 1, diaFecha));
  const inicio = new Date(Date.UTC(ano, mes - 2, diaFecha + 1));
  return { inicio: iso_utc(inicio), fim: iso_utc(fim) };
}

/** Competência cuja fatura inclui a compra nesta data (inverso de `intervalo_ciclo_fatura`). */
export function competencia_ciclo_da_data(dataISO: string, fechamento: number): string {
  const [anoStr, mesStr, diaStr] = dataISO.slice(0, 10).split("-");
  const ano = Number(anoStr);
  const mes = Number(mesStr);
  const dia = Number(diaStr);
  if (!ano || !mes || !dia) return dataISO.slice(0, 7);
  const diaFecha = Math.min(Math.max(1, fechamento), 28);
  if (dia <= diaFecha) {
    return `${anoStr}-${String(mes).padStart(2, "0")}`;
  }
  const proximo = new Date(Date.UTC(ano, mes, 1));
  return `${proximo.getUTCFullYear()}-${String(proximo.getUTCMonth() + 1).padStart(2, "0")}`;
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

/** Mês do P&L: conta = civil; cartão = competência do ciclo de fechamento. */
export function mes_resultado_do_movimento(
  dataMovimento: string,
  cartaoId: string | null | undefined,
  fechamento: number | null | undefined,
): string {
  const data = String(dataMovimento).slice(0, 10);
  const mesCivil = data.slice(0, 7);
  if (!cartaoId || fechamento == null || fechamento < 1) return mesCivil;
  return competencia_ciclo_da_data(data, fechamento);
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

export function movimento_no_resultado_do_mes(
  movimento: { dataMovimento: string; cartaoId?: string | null },
  mes: string,
  fechamentoPorCartao: ReadonlyMap<string, number>,
): boolean {
  const fechamento = movimento.cartaoId ? fechamentoPorCartao.get(movimento.cartaoId) : undefined;
  return mes_resultado_do_movimento(movimento.dataMovimento, movimento.cartaoId, fechamento) === mes;
}

/** Amplia o recorte civil para caber compras do ciclo que caíram no mês anterior. */
export function periodo_amplo_do_ciclo(
  periodo: { de: string; ate: string },
  mesesAnteriores = 1,
): { de: string; ate: string } {
  return {
    de: paraDataISO(adicionarMeses(deISOParaData(periodo.de), -mesesAnteriores)),
    ate: periodo.ate,
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
  const competencia = competencia_ciclo_da_data(data, entrada.fechamento);
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
    const ciclo = intervalo_ciclo_fatura(competencia, fechamento);
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
