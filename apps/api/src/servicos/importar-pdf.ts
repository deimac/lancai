import { createHash } from "node:crypto";
import { ErroValidacaoFinanceira } from "@lancai/financeiro";
import { estimar_compra_em_parcela } from "@lancai/open-finance";
import type { EventoFinanceiroNormalizado, ParcelamentoFonte } from "@lancai/tipos";
import { coerir_data_parcela_cartao, garantir_parcelas_subsequentes } from "@lancai/tipos";

export const MIN_CARACTERES_TEXTO_PDF = 40;

export type TipoDestinoPdf = "conta" | "cartao";

export type DestinoPdf = {
  tipo: TipoDestinoPdf;
  id: string;
  nome: string;
};

export type CandidatoDestinoPdf = DestinoPdf & {
  contaId?: string | null;
  sincronizada: boolean;
};

export type ParcelamentoPdf = ParcelamentoFonte;

export type LinhaExtraidaPdf = {
  ocorridoEm: string;
  descricao: string;
  valor: number;
  tipo: "receita" | "despesa";
  destinoSugerido: TipoDestinoPdf;
  parcelamento?: ParcelamentoPdf;
};

export type LinhaPreviewPdf = LinhaExtraidaPdf & {
  destino: DestinoPdf | null;
  aceita: boolean;
};

export type PreviewImportacaoPdf = {
  arquivoHash: string;
  provedor: string;
  origem: DestinoPdf;
  par: DestinoPdf | null;
  candidatosPar: DestinoPdf[];
  precisaSegundoDestino: boolean;
  textoInsuficiente: boolean;
  aviso?: string;
  linhas: LinhaPreviewPdf[];
};

export type LinhaConfirmacaoPdf = LinhaExtraidaPdf & {
  destino: DestinoPdf;
};

export function hash_bytes_arquivo(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function id_externo_pdf(entrada: {
  arquivoHash: string;
  ocorridoEm: string;
  valor: number;
  descricao: string;
  tipo: string;
  destinoId: string;
}): string {
  const descricao = entrada.descricao.trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");
  const valor = Number(entrada.valor).toFixed(2);
  const bruto = [
    entrada.arquivoHash,
    entrada.ocorridoEm,
    valor,
    descricao,
    entrada.tipo,
    entrada.destinoId,
  ].join("|");
  return createHash("sha256").update(bruto).digest("hex");
}

export function provedor_pdf_do_texto(texto: string): string {
  return /\brevolut\b/i.test(texto) ? "revolut-pdf" : "pdf";
}

export function texto_pdf_insuficiente(texto: string): boolean {
  return texto.replace(/\s+/g, " ").trim().length < MIN_CARACTERES_TEXTO_PDF;
}

const MESES: Record<string, number> = {
  jan: 1, january: 1, janeiro: 1,
  feb: 2, february: 2, fev: 2, fevereiro: 2,
  mar: 3, march: 3, marco: 3,
  apr: 4, april: 4, abr: 4, abril: 4,
  may: 5, mai: 5, maio: 5,
  jun: 6, june: 6, junho: 6,
  jul: 7, july: 7, julho: 7,
  aug: 8, august: 8, ago: 8, agosto: 8,
  sep: 9, sept: 9, september: 9, set: 9, setembro: 9,
  oct: 10, october: 10, out: 10, outubro: 10,
  nov: 11, november: 11, novembro: 11,
  dec: 12, december: 12, dez: 12, dezembro: 12,
};

const LIXO_LINHA =
  /^(statement|account statement|account|iban|balance|saldo|total|page\b|revolut ltd|date$|data$|description$|descri[cç][aã]o$|amount$|valor$|fee$|completed$|pending$|opening|closing|fatura|extrato|per[ií]odo|transactions?$|money (in|out)|paid$)/i;

const PROSA_LIXO =
  /\b(may include|applies? when|exchange rate|currency conversion|converted from|this (fee|statement|account)|interest rate|variable fee|international fee|fair usage|revolut ltd|registered in|sort code|account number|opening balance|closing balance|statement period|you (were|will|can|may)|about (this|the) fee|taxa (de|sobre)|cobran[cç]a de iof)\b/i;

/** Início de lançamento que se repete no extrato (Revolut e afins). */
const FONTE_MARCA =
  "Card Payment to|Card Payment from|ATM Withdrawal|Transfer to|Transfer from|Apple Pay|Google Pay|Cash at|PIX Enviado|PIX Recebido|Pix enviado|Pix recebido";

function regex_marcas_lancamento(): RegExp {
  return new RegExp(
    String.raw`\b(?:${FONTE_MARCA}|From(?=\s+[A-ZÁÉÍÓÚ][A-ZÁÉÍÓÚa-záéíóú]{2,}\s+[A-ZÁÉÍÓÚ]))\b`,
    "g",
  );
}

function normalizar_mes(bruto: string): number | null {
  const chave = bruto
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\./g, "");
  return MESES[chave] ?? null;
}

function iso_de_partes(ano: number, mes: number, dia: number): string | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || ano < 1990 || ano > 2100) return null;
  return `${String(ano).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

const FONTE_MES =
  "jan(?:uary)?|fev(?:ereiro)?|feb(?:ruary)?|mar(?:ch|ço|co)?|abr(?:il)?|apr(?:il)?|mai(?:o)?|may|jun(?:e|ho)?|jul(?:y|ho)?|ago(?:sto)?|aug(?:ust)?|set(?:embro)?|sep(?:t|tember)?|out(?:ubro)?|oct(?:ober)?|nov(?:ember|embro)?|dez(?:embro)?|dec(?:ember)?";

function regex_datas(): RegExp {
  return new RegExp(
    [
      String.raw`\d{4}-\d{2}-\d{2}`,
      String.raw`\d{1,2}\s+de\s+(?:${FONTE_MES})\.?\s+de\s+\d{4}`,
      String.raw`\d{1,2}\s+(?:${FONTE_MES})\.?\s+\d{4}`,
      String.raw`(?:${FONTE_MES})\.?\s+\d{1,2},?\s+\d{4}`,
      String.raw`\d{1,2}/\d{1,2}/\d{2,4}`,
    ].join("|"),
    "gi",
  );
}

export function parse_data_lancamento(texto: string): string | null {
  const iso = texto.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return iso_de_partes(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const en = texto.match(
    new RegExp(String.raw`\b(\d{1,2})\s+(${FONTE_MES})\.?\s+(\d{4})\b`, "i"),
  );
  if (en) {
    const mes = normalizar_mes(en[2]!);
    if (mes) return iso_de_partes(Number(en[3]), mes, Number(en[1]));
  }

  const enRev = texto.match(
    new RegExp(String.raw`\b(${FONTE_MES})\.?\s+(\d{1,2}),?\s+(\d{4})\b`, "i"),
  );
  if (enRev) {
    const mes = normalizar_mes(enRev[1]!);
    if (mes) return iso_de_partes(Number(enRev[3]), mes, Number(enRev[2]));
  }

  const pt = texto.match(
    new RegExp(String.raw`\b(\d{1,2})\s+de\s+(${FONTE_MES})\.?\s+de\s+(\d{4})\b`, "i"),
  );
  if (pt) {
    const mes = normalizar_mes(pt[2]!);
    if (mes) return iso_de_partes(Number(pt[3]), mes, Number(pt[1]));
  }

  const br = texto.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (br) return iso_de_partes(Number(br[3]), Number(br[2]), Number(br[1]));

  const brCurto = texto.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2})\b/);
  if (brCurto) {
    const ano = Number(brCurto[3]) >= 70 ? 1900 + Number(brCurto[3]) : 2000 + Number(brCurto[3]);
    return iso_de_partes(ano, Number(brCurto[2]), Number(brCurto[1]));
  }
  return null;
}

function parse_numero_moeda(bruto: string): number | null {
  const temVirgula = bruto.includes(",");
  const temPonto = bruto.includes(".");
  let normalizado = bruto;
  if (temVirgula && temPonto) {
    normalizado = bruto.includes(",") && bruto.lastIndexOf(",") > bruto.lastIndexOf(".")
      ? bruto.replace(/\./g, "").replace(",", ".")
      : bruto.replace(/,/g, "");
  } else if (temVirgula) {
    normalizado = bruto.replace(",", ".");
  }
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

const REGEX_VALOR =
  /(?:[€£]|R\$)?\s*([−–-])?\s*(?:[€£]|R\$)?\s*([−–-])?\s*(\d{1,3}(?:\.\d{3})+,\d{2}|\d{1,3}(?:,\d{3})+\.\d{2}|\d+,\d{2}|\d+\.\d{2})(?:\s*(?:BRL|EUR|USD|GBP|R\$))?/gi;

function parse_valores_com_indice(texto: string): Array<{
  valor: number;
  negativo: boolean;
  mais: boolean;
  inicio: number;
  fim: number;
}> {
  const encontrados: Array<{
    valor: number;
    negativo: boolean;
    mais: boolean;
    inicio: number;
    fim: number;
  }> = [];
  const regex = new RegExp(REGEX_VALOR.source, "gi");
  for (const match of texto.matchAll(regex)) {
    if (match.index == null) continue;
    const n = parse_numero_moeda(match[3]!);
    if (n == null || n < 0.01) continue;
    const depois = texto[match.index + match[0].length] ?? "";
    if (depois === "%") continue;
    const antes = texto.slice(Math.max(0, match.index - 1), match.index);
    const negativo =
      Boolean(match[1] || match[2]) ||
      antes === "(" ||
      /\(\s*[\d.,]+\s*\)/.test(match[0]);
    const mais = antes === "+" || match[0].trim().startsWith("+");
    encontrados.push({
      valor: n,
      negativo,
      mais,
      inicio: match.index,
      fim: match.index + match[0].length,
    });
  }
  return encontrados;
}

function linha_e_lixo(texto: string): boolean {
  return LIXO_LINHA.test(texto.trim()) || /page\s+\d+\s+of\s+\d+/i.test(texto);
}

function desc_e_cabecalho(descricao: string): boolean {
  if (/card payment|pix|transfer|atm|from\b|^to\b|compra|parcela/i.test(descricao) && !PROSA_LIXO.test(descricao)) {
    return /iban|bic\b|account number|sort code|statement period|opening balance|closing balance/i.test(
      descricao,
    );
  }
  return (
    /iban|bic\b|account number|sort code|statement period|opening balance|closing balance/i.test(descricao) ||
    PROSA_LIXO.test(descricao)
  );
}

function desc_parece_prosa(descricao: string): boolean {
  const palavras = descricao.split(/\s+/).filter(Boolean);
  if (descricao.length > 90 || palavras.length > 12) return true;
  if (PROSA_LIXO.test(descricao)) return true;
  if (/=/.test(descricao) && /\b(eur|usd|gbp|brl)\b/i.test(descricao)) return true;
  return false;
}

function limpar_descricao(texto: string): string {
  return texto
    .replace(new RegExp(REGEX_VALOR.source, "gi"), " ")
    .replace(regex_datas(), " ")
    .replace(/\bcompleted\b|\bpending\b|\bposted\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tipo_e_credito_explicito(desc: string, mais: boolean): boolean {
  if (mais) return true;
  if (
    /refund|estorno|cashback|salary|sal[aá]rio|dep[oó]sito|pix recebido|pagamento recebido|pagto recebido|pgto recebido/i.test(
      desc,
    )
  ) {
    return true;
  }
  return /^\s*from\b/i.test(desc);
}

function sugerir_tipo_pdf(desc: string, negativo: boolean, mais = false): "receita" | "despesa" {
  if (tipo_e_credito_explicito(desc, mais)) return "receita";
  if (negativo) return "despesa";
  if (/card payment|compra|pix enviado|atm|saque|anuidade|transfer to|^to\b/i.test(desc)) {
    return "despesa";
  }
  // Extrato/fatura: valor sem sinal é saída, não entrada.
  return "despesa";
}

function sugerir_destino_pdf(desc: string): TipoDestinoPdf {
  if (/card payment|pagamento (no )?cart[aã]o|compra no cart[aã]o/i.test(desc)) return "cartao";
  if (/pix|ted|doc|transfer|atm|c[aâ]mbio|exchange|from\b|salary|boleto|saque/i.test(desc)) {
    return "conta";
  }
  if (/^to\b/i.test(desc) && !/card/i.test(desc)) return "conta";
  if (/card|parcela|cart[aã]o/i.test(desc)) return "cartao";
  if (/ifood|uber|rappi|spotify|netflix|amazon/i.test(desc)) return "cartao";
  return "conta";
}

const MAX_PARCELAS_PDF = 48;

function parcelamento_valido(numero: number, total: number): boolean {
  return (
    Number.isInteger(numero) &&
    Number.isInteger(total) &&
    total >= 2 &&
    total <= MAX_PARCELAS_PDF &&
    numero >= 1 &&
    numero <= total
  );
}

function montar_parcelamento_pdf(
  numero: number,
  total: number,
  ocorridoEm: string,
  valor: number,
  atual?: ParcelamentoPdf,
  competenciaFatura?: string | null,
): ParcelamentoPdf {
  const impressaForaDoMes =
    Boolean(competenciaFatura) &&
    /^\d{4}-\d{2}$/.test(competenciaFatura!) &&
    !ocorridoEm.startsWith(`${competenciaFatura}-`);
  const compraEm =
    atual?.compraEm ??
    (impressaForaDoMes || numero <= 1 ? ocorridoEm : estimar_compra_em_parcela(ocorridoEm, numero));
  return {
    numero,
    total,
    compraEm,
    valorTotal: atual?.valorTotal ?? Number((valor * total).toFixed(2)),
  };
}

/**
 * Procura 1/4, 01/04, parcela 1 de 4 — no pedaço inteiro da linha, inclusive
 * depois do valor. Não para no primeiro `13/07` (dia/mês) inválido como parcela.
 */
export function detectar_parcelamento_pdf(
  texto: string,
  ocorridoEm: string,
  valor: number,
  competenciaFatura?: string | null,
): ParcelamentoPdf | undefined {
  if (!texto.trim()) return undefined;

  type Candidato = { numero: number; total: number; peso: number };
  const candidatos: Candidato[] = [];

  function considerar(numeroBruto: string, totalBruto: string, inicio: number, extra: number) {
    const numero = Number(numeroBruto);
    const total = Number(totalBruto);
    if (!parcelamento_valido(numero, total)) return;
    const janela = texto.slice(Math.max(0, inicio - 16), inicio + 28);
    const peso =
      extra +
      (/\bparc(?:ela)?s?\.?\b/i.test(janela) ? 10 : 0) +
      inicio;
    candidatos.push({ numero, total, peso });
  }

  // Não casa 13/07/2026 (precisa do terceiro `/`). `(?:^|[^\d/])` evita 2026/13.
  const fracao = /(?:^|[^\d/])(\d{1,2})\s*\/\s*(\d{1,2})(?!\s*\/\s*\d)/g;
  for (const match of texto.matchAll(fracao)) {
    if (match.index == null) continue;
    considerar(match[1]!, match[2]!, match.index, 0);
  }
  const parcelaDe = /\bparc(?:ela)?s?\.?\s*(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\b/gi;
  for (const match of texto.matchAll(parcelaDe)) {
    if (match.index == null) continue;
    considerar(match[1]!, match[2]!, match.index, 20);
  }
  const deVezes = /\b(\d{1,2})\s+de\s+(\d{1,2})\s*x\b/gi;
  for (const match of texto.matchAll(deVezes)) {
    if (match.index == null) continue;
    considerar(match[1]!, match[2]!, match.index, 15);
  }

  if (candidatos.length === 0) return undefined;
  candidatos.sort((a, b) => b.peso - a.peso);
  const escolhido = candidatos[0]!;
  return montar_parcelamento_pdf(escolhido.numero, escolhido.total, ocorridoEm, valor, undefined, competenciaFatura);
}

export function completar_parcelamento_pdf(linha: {
  ocorridoEm: string;
  descricao: string;
  valor: number;
  parcelamento?: ParcelamentoPdf;
  competenciaFatura?: string | null;
}): ParcelamentoPdf | undefined {
  const base =
    linha.parcelamento ??
    detectar_parcelamento_pdf(linha.descricao, linha.ocorridoEm, linha.valor, linha.competenciaFatura);
  if (!base) return undefined;
  return montar_parcelamento_pdf(
    base.numero,
    base.total,
    linha.ocorridoEm,
    linha.valor,
    base,
    linha.competenciaFatura,
  );
}

export function enriquecer_linha_pdf(linha: LinhaExtraidaPdf): LinhaExtraidaPdf {
  const parcelamento = completar_parcelamento_pdf(linha);
  if (!parcelamento) return linha;
  return { ...linha, parcelamento };
}

/**
 * Reconstrói linhas visuais a partir dos itens do PDF (origem embaixo).
 * Tabelas de extrato perdem a linha se só concatenarmos o texto da página.
 */
export function linhas_visuais_pdf(
  itens: Array<{ str: string; x: number; y: number }>,
): string[] {
  const grupos = new Map<number, Array<{ x: number; str: string }>>();
  for (const item of itens) {
    const str = item.str.replace(/\s+/g, " ");
    if (!str.trim()) continue;
    const y = Math.round(item.y / 4) * 4;
    const grupo = grupos.get(y) ?? [];
    grupo.push({ x: item.x, str });
    grupos.set(y, grupo);
  }
  return [...grupos.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, pedacos]) =>
      pedacos
        .sort((a, b) => a.x - b.x)
        .map((pedaco) => pedaco.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

function datas_com_indice(plano: string): Array<{ iso: string; inicio: number; fim: number }> {
  const datas: Array<{ iso: string; inicio: number; fim: number }> = [];
  for (const match of plano.matchAll(regex_datas())) {
    if (match.index == null) continue;
    const iso = parse_data_lancamento(match[0]);
    if (!iso) continue;
    datas.push({ iso, inicio: match.index, fim: match.index + match[0].length });
  }
  return datas;
}

function data_e_periodo(plano: string, data: { inicio: number; fim: number }): boolean {
  const antes = plano.slice(Math.max(0, data.inicio - 48), data.inicio);
  const depois = plano.slice(data.fim, Math.min(plano.length, data.fim + 28));
  if (
    /\b(vencimento|due date|per[ií]odo|fechamento|abertura|emiss[aã]o|statement period|v[aá]lido)\b/i.test(
      antes,
    )
  ) {
    return true;
  }
  return /^\s*(?:[aá]|até|-|–|—)\s*\d/i.test(depois);
}

/** Mês da fatura (vencimento/período no cabeçalho), não a data impressa da compra. */
export function inferir_competencia_fatura_pdf(texto: string): string | null {
  const plano = texto.replace(/\s+/g, " ").trim();
  if (!plano) return null;
  const datas = datas_com_indice(plano);
  for (const data of datas) {
    const antes = plano.slice(Math.max(0, data.inicio - 48), data.inicio);
    if (/\b(vencimento|due date)\b/i.test(antes)) return data.iso.slice(0, 7);
  }
  const periodo = datas.find((data) => data_e_periodo(plano, data));
  return periodo?.iso.slice(0, 7) ?? null;
}

function data_antes(datas: Array<{ iso: string; inicio: number; fim: number }>, posicao: number): string | null {
  let encontrada: string | null = null;
  for (const data of datas) {
    if (data.fim <= posicao) encontrada = data.iso;
    else break;
  }
  return encontrada;
}

function emitir_se_valido(
  saida: LinhaExtraidaPdf[],
  dataIso: string | null,
  descricaoBruta: string,
  valor: { valor: number; negativo: boolean; mais: boolean },
  textoParcela?: string,
  competenciaFatura?: string | null,
): void {
  if (!dataIso) return;
  const descricao = limpar_descricao(descricaoBruta).slice(0, 180);
  if (!descricao || descricao.length < 2) return;
  if (linha_e_lixo(descricao) || desc_e_cabecalho(descricao) || desc_parece_prosa(descricao)) return;
  if (/^(fee|taxa|iof|fx fee|international fee)$/i.test(descricao)) return;
  const parcela =
    detectar_parcelamento_pdf(textoParcela ?? descricaoBruta, dataIso, valor.valor, competenciaFatura) ??
    detectar_parcelamento_pdf(descricao, dataIso, valor.valor, competenciaFatura);
  saida.push({
    ocorridoEm: dataIso,
    descricao,
    valor: valor.valor,
    tipo: sugerir_tipo_pdf(descricao, valor.negativo, valor.mais),
    destinoSugerido: sugerir_destino_pdf(descricao),
    ...(parcela ? { parcelamento: parcela } : {}),
  });
}

/**
 * Tabela padronizada: Data | Descrição | Valor.
 * Cada data da linha vale só para aquele lançamento — não herda a do cabeçalho.
 */
function extrair_por_tabela(
  plano: string,
  datas: Array<{ iso: string; inicio: number; fim: number }>,
  competenciaFatura?: string | null,
): LinhaExtraidaPdf[] {
  const linhasData = datas.filter((data) => !data_e_periodo(plano, data));
  if (linhasData.length < 2) return [];

  const datasPt = (
    plano.match(new RegExp(String.raw`\d{1,2}\s+de\s+(?:${FONTE_MES})\.?`, "gi")) ?? []
  ).length;

  const saida: LinhaExtraidaPdf[] = [];
  let chunksComVariosValores = 0;
  for (let i = 0; i < linhasData.length; i++) {
    const data = linhasData[i]!;
    const chunk = plano.slice(data.fim, linhasData[i + 1]?.inicio ?? plano.length);
    const valores = parse_valores_com_indice(chunk);
    if (valores.length > 1) chunksComVariosValores += 1;
    const principal = valores[0];
    if (!principal) continue;
    emitir_se_valido(saida, data.iso, chunk.slice(0, principal.inicio), principal, chunk, competenciaFatura);
  }
  if (datasPt < 2 && chunksComVariosValores > 0) return [];
  return saida.length >= 2 ? saida : [];
}
function extrair_por_marcas_recorrentes(
  plano: string,
  datas: Array<{ iso: string; inicio: number; fim: number }>,
  competenciaFatura?: string | null,
): LinhaExtraidaPdf[] {
  const marcas = [...plano.matchAll(regex_marcas_lancamento())];
  if (marcas.length < 2) return [];

  const saida: LinhaExtraidaPdf[] = [];
  for (let i = 0; i < marcas.length; i++) {
    const marca = marcas[i]!;
    if (marca.index == null) continue;
    const fim = marcas[i + 1]?.index ?? plano.length;
    const bloco = plano.slice(marca.index, fim);
    if (desc_parece_prosa(limpar_descricao(bloco))) continue;
    const valores = parse_valores_com_indice(bloco);
    const principal = valores.find((item) => item.valor >= 0.01);
    if (!principal) continue;
    const data = data_antes(datas, marca.index) ?? parse_data_lancamento(bloco);
    emitir_se_valido(
      saida,
      data,
      bloco.slice(0, principal.inicio) || bloco,
      principal,
      bloco,
      competenciaFatura,
    );
  }
  return saida;
}

function extrair_por_data_valor(
  plano: string,
  datas: Array<{ iso: string; inicio: number; fim: number }>,
  competenciaFatura?: string | null,
): LinhaExtraidaPdf[] {
  const saida: LinhaExtraidaPdf[] = [];
  for (let i = 0; i < datas.length; i++) {
    const data = datas[i]!;
    const chunk = plano.slice(data.fim, datas[i + 1]?.inicio ?? plano.length);
    const valores = parse_valores_com_indice(chunk);
    for (let v = 0; v < valores.length; v++) {
      const atual = valores[v]!;
      const descInicio = v === 0 ? 0 : valores[v - 1]!.fim;
      const trecho = chunk.slice(descInicio, valores[v + 1]?.inicio ?? chunk.length);
      emitir_se_valido(saida, data.iso, chunk.slice(descInicio, atual.inicio), atual, trecho, competenciaFatura);
    }
  }
  return saida;
}

/**
 * Extrai lançamentos pelo texto corrido. Prefere tabela Data/Descrição/Valor,
 * depois o padrão que se repete (Card Payment, PIX…) e ignora taxa/câmbio/saldo.
 */
export function extrair_lancamentos_do_texto(texto: string): LinhaExtraidaPdf[] {
  const plano = texto.replace(/\s+/g, " ").trim();
  if (!plano) return [];
  const datas = datas_com_indice(plano);
  if (datas.length === 0) return [];
  const competenciaFatura = inferir_competencia_fatura_pdf(texto);

  const porTabela = extrair_por_tabela(plano, datas, competenciaFatura);
  const linhas =
    porTabela.length >= 2
      ? porTabela
      : (() => {
          const porMarca = extrair_por_marcas_recorrentes(plano, datas, competenciaFatura);
          return porMarca.length >= 2 ? porMarca : extrair_por_data_valor(plano, datas, competenciaFatura);
        })();
  return ajustar_parcelas_ao_mes_fatura(linhas, competenciaFatura);
}

export function ajustar_parcelas_ao_mes_fatura(
  linhas: LinhaExtraidaPdf[],
  competenciaFatura: string | null,
): LinhaExtraidaPdf[] {
  if (!competenciaFatura || !/^\d{4}-\d{2}$/.test(competenciaFatura)) return linhas;
  return linhas.map((linha) => {
    if (!linha.parcelamento) return linha;
    const compraEm = linha.parcelamento.compraEm ?? linha.ocorridoEm;
    const ocorridoEm = linha.ocorridoEm.startsWith(`${competenciaFatura}-`)
      ? linha.ocorridoEm
      : `${competenciaFatura}-01`;
    return {
      ...linha,
      ocorridoEm,
      parcelamento: { ...linha.parcelamento, compraEm },
    };
  });
}

export function exigir_destino_manual(destino: {
  nome: string;
  sincronizada: boolean;
}): void {
  if (destino.sincronizada) {
    throw new ErroValidacaoFinanceira(
      `"${destino.nome}" está sincronizada com o banco. Importar fatura PDF só vale em conta ou cartão manuais.`,
    );
  }
}

function nomes_iguais(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase("pt-BR") === b.trim().toLocaleLowerCase("pt-BR");
}

function so_manuais(candidatos: CandidatoDestinoPdf[]): CandidatoDestinoPdf[] {
  return candidatos.filter((item) => !item.sincronizada);
}

/**
 * Par conta↔cartão: `cartao.contaId` primeiro; se faltar, o mesmo nome.
 * Vários candidatos → o preview pede escolha; nenhum → linha fica sem destino.
 */
export function resolver_par_pdf(entrada: {
  origem: DestinoPdf;
  contas: CandidatoDestinoPdf[];
  cartoes: CandidatoDestinoPdf[];
}): { par: DestinoPdf | null; candidatosPar: DestinoPdf[] } {
  const contas = so_manuais(entrada.contas);
  const cartoes = so_manuais(entrada.cartoes);

  if (entrada.origem.tipo === "conta") {
    const ligados = cartoes.filter((cartao) => cartao.contaId === entrada.origem.id);
    const candidatos = (
      ligados.length > 0
        ? ligados
        : cartoes.filter((cartao) => nomes_iguais(cartao.nome, entrada.origem.nome))
    ).map((cartao) => ({ tipo: "cartao" as const, id: cartao.id, nome: cartao.nome }));
    return {
      par: candidatos.length === 1 ? candidatos[0]! : null,
      candidatosPar: candidatos,
    };
  }

  const cartaoOrigem = cartoes.find((cartao) => cartao.id === entrada.origem.id);
  const ligados = cartaoOrigem?.contaId
    ? contas.filter((conta) => conta.id === cartaoOrigem.contaId)
    : [];
  const candidatos = (
    ligados.length > 0
      ? ligados
      : contas.filter((conta) => nomes_iguais(conta.nome, entrada.origem.nome))
  ).map((conta) => ({ tipo: "conta" as const, id: conta.id, nome: conta.nome }));
  return {
    par: candidatos.length === 1 ? candidatos[0]! : null,
    candidatosPar: candidatos,
  };
}

function tipo_no_destino(linha: LinhaExtraidaPdf, origem: DestinoPdf): "receita" | "despesa" {
  if (origem.tipo !== "cartao") return linha.tipo;
  if (tipo_e_credito_explicito(linha.descricao, false) && linha.tipo === "receita") return "receita";
  return "despesa";
}

/**
 * Fatura entra no destino do menu (conta ou cartão). Não espalha linha a linha:
 * escolher conta/cartão em cada lançamento não é uso real.
 * No cartão, compra é despesa (consome limite), salvo crédito explícito.
 */
export function rotear_linhas_pdf(
  linhas: LinhaExtraidaPdf[],
  contexto: { origem: DestinoPdf; par?: DestinoPdf | null },
): LinhaPreviewPdf[] {
  return linhas.map((linha) => ({
    ...linha,
    tipo: tipo_no_destino(linha, contexto.origem),
    destinoSugerido: contexto.origem.tipo,
    destino: contexto.origem,
    aceita: true,
  }));
}

export function aplicar_segundo_destino(
  linhas: LinhaPreviewPdf[],
  segundo: DestinoPdf,
): LinhaPreviewPdf[] {
  return linhas.map((linha) => {
    if (linha.destinoSugerido === segundo.tipo) {
      return { ...linha, destino: segundo, aceita: true };
    }
    return linha;
  });
}

export function chave_linha_extraida(linha: LinhaExtraidaPdf): string {
  const descricao = linha.descricao.trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");
  return [linha.ocorridoEm, Number(linha.valor).toFixed(2), descricao, linha.tipo, linha.destinoSugerido].join(
    "|",
  );
}

export function unir_linhas_extraidas(lotes: LinhaExtraidaPdf[][]): LinhaExtraidaPdf[] {
  const visto = new Set<string>();
  const saida: LinhaExtraidaPdf[] = [];
  for (const lote of lotes) {
    for (const linha of lote) {
      const chave = chave_linha_extraida(linha);
      if (visto.has(chave)) continue;
      visto.add(chave);
      saida.push(linha);
    }
  }
  return saida;
}

/** Agrupa páginas para caber num único chamado de LLM, sem cortar no meio da página. */
export function lotes_texto_pdf(paginas: string[], maxCaracteres = 8_000): string[] {
  const lotes: string[] = [];
  let atual: string[] = [];
  let tamanho = 0;
  for (const pagina of paginas) {
    const trecho = pagina.replace(/\s+/g, " ").trim();
    if (!trecho) continue;
    if (atual.length > 0 && tamanho + trecho.length > maxCaracteres) {
      lotes.push(atual.join("\n\n"));
      atual = [pagina.trim()];
      tamanho = trecho.length;
    } else {
      atual.push(pagina.trim());
      tamanho += trecho.length;
    }
  }
  if (atual.length > 0) lotes.push(atual.join("\n\n"));
  return lotes;
}

export function montar_preview_pdf(entrada: {
  linhas: LinhaExtraidaPdf[];
  origem: DestinoPdf;
  contas: CandidatoDestinoPdf[];
  cartoes: CandidatoDestinoPdf[];
  arquivoHash: string;
  provedor: string;
  textoInsuficiente: boolean;
  aviso?: string;
}): PreviewImportacaoPdf {
  const { par, candidatosPar } = resolver_par_pdf({
    origem: entrada.origem,
    contas: entrada.contas,
    cartoes: entrada.cartoes,
  });
  const linhas = rotear_linhas_pdf(entrada.linhas, { origem: entrada.origem, par });
  const precisaSegundoDestino = false;

  return {
    arquivoHash: entrada.arquivoHash,
    provedor: entrada.provedor,
    origem: entrada.origem,
    par,
    candidatosPar,
    precisaSegundoDestino,
    textoInsuficiente: entrada.textoInsuficiente,
    aviso: entrada.aviso,
    linhas,
  };
}

export function montar_eventos_pdf(entrada: {
  linhas: LinhaConfirmacaoPdf[];
  destinos: Array<{
    tipo: TipoDestinoPdf;
    id: string;
    workspaceId: string;
    sincronizada: boolean;
    nome: string;
    fechamento?: number;
    vencimento?: number;
  }>;
  arquivoHash: string;
  provedor: string;
}): EventoFinanceiroNormalizado[] {
  const porId = new Map(entrada.destinos.map((destino) => [destino.id, destino]));

  const eventos = entrada.linhas.map((linha) => {
    const destino = porId.get(linha.destino.id);
    if (!destino) {
      throw new ErroValidacaoFinanceira(
        `Destino "${linha.destino.nome}" não encontrado para a linha ${linha.descricao}.`,
      );
    }
    exigir_destino_manual(destino);
    if (destino.tipo !== linha.destino.tipo) {
      throw new ErroValidacaoFinanceira(
        `Destino "${destino.nome}" não é ${linha.destino.tipo === "conta" ? "uma conta" : "um cartão"}.`,
      );
    }

    const parcelamento = completar_parcelamento_pdf(linha);
    let ocorridoEm = linha.ocorridoEm;
    if (
      parcelamento &&
      destino.tipo === "cartao" &&
      destino.fechamento != null &&
      destino.vencimento != null
    ) {
      ocorridoEm = coerir_data_parcela_cartao({
        ocorridoEm,
        numero: parcelamento.numero,
        compraEm: parcelamento.compraEm,
        fechamento: destino.fechamento,
        vencimento: destino.vencimento,
      });
    }

    const evento: EventoFinanceiroNormalizado = {
      workspaceId: destino.workspaceId,
      fonte: "pdf",
      provedor: entrada.provedor,
      idExterno: id_externo_pdf({
        arquivoHash: entrada.arquivoHash,
        ocorridoEm,
        valor: linha.valor,
        descricao: linha.descricao,
        tipo: linha.tipo,
        destinoId: destino.id,
      }),
      ocorridoEm,
      valor: linha.valor,
      tipo: linha.tipo,
      descricaoFonte: linha.descricao,
      statusFonte: "confirmado",
      fatoImutavel: true,
      ...(destino.tipo === "conta" ? { contaId: destino.id } : { cartaoId: destino.id }),
      ...(parcelamento ? { parcelamento } : {}),
    };
    return evento;
  });

  return espacar_eventos_parcela_pdf(eventos);
}

function espacar_eventos_parcela_pdf(
  eventos: EventoFinanceiroNormalizado[],
): EventoFinanceiroNormalizado[] {
  const saida = [...eventos];
  const indices = saida
    .map((evento, indice) =>
      evento.cartaoId && evento.parcelamento?.numero && evento.parcelamento.compraEm ? indice : -1,
    )
    .filter((indice) => indice >= 0);

  const clusters: number[][] = [];
  for (const indice of indices) {
    const atual = saida[indice]!;
    const cluster = clusters.find((grupo) => {
      const ancora = saida[grupo[0]!]!;
      return (
        ancora.cartaoId === atual.cartaoId &&
        ancora.parcelamento?.total === atual.parcelamento?.total &&
        ancora.parcelamento?.compraEm === atual.parcelamento?.compraEm
      );
    });
    if (cluster) cluster.push(indice);
    else clusters.push([indice]);
  }

  for (const cluster of clusters) {
    const datas = garantir_parcelas_subsequentes(
      cluster.map((indice) => ({
        numero: saida[indice]!.parcelamento!.numero,
        dataMovimento: saida[indice]!.ocorridoEm,
      })),
    );
    for (const indice of cluster) {
      const data = datas.get(saida[indice]!.parcelamento!.numero);
      if (!data || data === saida[indice]!.ocorridoEm) continue;
      saida[indice] = { ...saida[indice]!, ocorridoEm: data };
    }
  }
  return saida;
}
