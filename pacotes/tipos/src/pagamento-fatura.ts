/**
 * Heurística de sugestão de pagamento de fatura (Conhecimento).
 * Nunca aplica sozinha: a pessoa confirma no Extrato.
 */

const PADROES_DESCRICAO = [
  /\bfatura\b/i,
  /\bpagto\b/i,
  /\bpgto\b/i,
  /\bpagamento\b/i,
  /\bcart[aã]o\b/i,
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
  const descricaoCasa = descricao_parece_pagamento_fatura(
    movimento.descricao,
    movimento.descricaoFonte,
  );

  const candidatos = cartoes_candidatos(movimento, cartoes);
  if (candidatos.length === 0) return null;

  const par = sugestao_par_credito(movimento, valor, candidatos, movimentos);
  if (par) return par;

  for (const cartao of candidatos) {
    const competencia = competencia_vencimento_proximo(movimento.dataMovimento, cartao.vencimento);
    if (descricaoCasa) {
      return {
        cartaoId: cartao.id,
        cartaoNome: cartao.nome,
        competencia,
        motivo: "descricao",
      };
    }

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
