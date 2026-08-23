import { createHash } from "node:crypto";
import { ErroValidacaoFinanceira } from "@lancai/financeiro";
import { estimar_compra_em_parcela } from "@lancai/open-finance";
import type { EventoFinanceiroNormalizado, ParcelamentoFonte } from "@lancai/tipos";

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

function parcelamento_da_desc(
  desc: string,
  ocorridoEm: string,
  valor: number,
): ParcelamentoPdf | undefined {
  const match = desc.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/);
  if (!match) return undefined;
  const numero = Number(match[1]);
  const total = Number(match[2]);
  if (total < 2 || numero < 1 || numero > total) return undefined;
  return {
    numero,
    total,
    compraEm: estimar_compra_em_parcela(ocorridoEm, numero),
    valorTotal: Number((valor * total).toFixed(2)),
  };
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
): void {
  if (!dataIso) return;
  const descricao = limpar_descricao(descricaoBruta).slice(0, 180);
  if (!descricao || descricao.length < 2) return;
  if (linha_e_lixo(descricao) || desc_e_cabecalho(descricao) || desc_parece_prosa(descricao)) return;
  if (/^(fee|taxa|iof|fx fee|international fee)$/i.test(descricao)) return;
  const parcela = parcelamento_da_desc(descricao, dataIso, valor.valor);
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
    const descricao = limpar_descricao(chunk.slice(0, principal.inicio));
    emitir_se_valido(saida, data.iso, descricao, principal);
  }
  if (datasPt < 2 && chunksComVariosValores > 0) return [];
  return saida.length >= 2 ? saida : [];
}
function extrair_por_marcas_recorrentes(
  plano: string,
  datas: Array<{ iso: string; inicio: number; fim: number }>,
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
    emitir_se_valido(saida, data, bloco.slice(0, principal.inicio) || bloco, principal);
  }
  return saida;
}

function extrair_por_data_valor(
  plano: string,
  datas: Array<{ iso: string; inicio: number; fim: number }>,
): LinhaExtraidaPdf[] {
  const saida: LinhaExtraidaPdf[] = [];
  for (let i = 0; i < datas.length; i++) {
    const data = datas[i]!;
    const chunk = plano.slice(data.fim, datas[i + 1]?.inicio ?? plano.length);
    const valores = parse_valores_com_indice(chunk);
    for (let v = 0; v < valores.length; v++) {
      const atual = valores[v]!;
      const descInicio = v === 0 ? 0 : valores[v - 1]!.fim;
      const descricao = limpar_descricao(chunk.slice(descInicio, atual.inicio));
      emitir_se_valido(saida, data.iso, descricao, atual);
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

  const porTabela = extrair_por_tabela(plano, datas);
  if (porTabela.length >= 2) return porTabela;

  const porMarca = extrair_por_marcas_recorrentes(plano, datas);
  if (porMarca.length >= 2) return porMarca;
  return extrair_por_data_valor(plano, datas);
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
  }>;
  arquivoHash: string;
  provedor: string;
}): EventoFinanceiroNormalizado[] {
  const porId = new Map(entrada.destinos.map((destino) => [destino.id, destino]));

  return entrada.linhas.map((linha) => {
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

    const evento: EventoFinanceiroNormalizado = {
      workspaceId: destino.workspaceId,
      fonte: "pdf",
      provedor: entrada.provedor,
      idExterno: id_externo_pdf({
        arquivoHash: entrada.arquivoHash,
        ocorridoEm: linha.ocorridoEm,
        valor: linha.valor,
        descricao: linha.descricao,
        tipo: linha.tipo,
        destinoId: destino.id,
      }),
      ocorridoEm: linha.ocorridoEm,
      valor: linha.valor,
      tipo: linha.tipo,
      descricaoFonte: linha.descricao,
      statusFonte: "confirmado",
      fatoImutavel: true,
      ...(destino.tipo === "conta" ? { contaId: destino.id } : { cartaoId: destino.id }),
      ...(linha.parcelamento ? { parcelamento: linha.parcelamento } : {}),
    };
    return evento;
  });
}
