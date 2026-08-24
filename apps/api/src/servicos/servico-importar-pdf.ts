import type { FastifyBaseLogger } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  CATEGORIA_NAO_CLASSIFICADO,
  cartao as cartaoTabela,
  categoria as categoriaTabela,
  conta as contaTabela,
  obter_banco,
} from "@lancai/banco";
import { ErroRecursoNaoEncontrado, ErroValidacaoFinanceira, MotorFinanceiro, RepositorioFinanceiroDrizzle } from "@lancai/financeiro";
import { OrquestradorIA } from "@lancai/ia";
import type { ParcelaSerieEntrada, ResumoIngestao } from "@lancai/open-finance";
import { estimar_compra_em_parcela, planejar_complemento_parcelas_cartao } from "@lancai/open-finance";
import {
  data_iso_parcela,
  parcelamentoFonteSchema,
  type EventoFinanceiroNormalizado,
} from "@lancai/tipos";
import {
  type CandidatoDestinoPdf,
  type DestinoPdf,
  type LinhaConfirmacaoPdf,
  type LinhaExtraidaPdf,
  type PreviewImportacaoPdf,
  type TipoDestinoPdf,
  enriquecer_linha_pdf,
  exigir_destino_manual,
  hash_bytes_arquivo,
  lotes_texto_pdf,
  montar_eventos_pdf,
  montar_preview_pdf,
  provedor_pdf_do_texto,
  texto_pdf_insuficiente,
  unir_linhas_extraidas,
  extrair_lancamentos_do_texto,
  linhas_visuais_pdf,
} from "./importar-pdf";
import { enriquecer_apos_ingestao } from "./pos-ingestao-open-finance";

const LIMITE_CARACTERES_LOTE = 2_500;
const LIMITE_ARQUIVO_BYTES = 12 * 1024 * 1024;

function para_data_iso(bruto: unknown): unknown {
  if (typeof bruto !== "string") return bruto;
  const texto = bruto.trim();
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!br) return texto;
  return `${br[3]}-${br[2]!.padStart(2, "0")}-${br[1]!.padStart(2, "0")}`;
}

function para_valor_positivo(bruto: unknown): unknown {
  if (typeof bruto === "number" && Number.isFinite(bruto)) return Math.abs(bruto);
  if (typeof bruto !== "string") return bruto;
  const limpo = bruto.trim().replace(/[^\d,.-]/g, "");
  if (!limpo) return bruto;
  const temVirgula = limpo.includes(",");
  const normalizado = temVirgula
    ? limpo.replace(/\./g, "").replace(",", ".")
    : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) ? Math.abs(n) : bruto;
}

const schemaLinhaExtraida = z.object({
  ocorridoEm: z.preprocess(para_data_iso, z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  descricao: z.string().trim().min(1),
  valor: z.preprocess(para_valor_positivo, z.number().positive()),
  tipo: z.enum(["receita", "despesa"]),
  destinoSugerido: z.enum(["conta", "cartao"]),
  parcelamento: z.preprocess(
    (valor) =>
      valor && typeof valor === "object" && "numero" in valor && "total" in valor
        ? valor
        : undefined,
    parcelamentoFonteSchema.optional(),
  ),
});

const schemaObjetoLinhas = z.object({
  linhas: z.array(schemaLinhaExtraida),
});

export async function extrair_texto_pdf(bytes: Uint8Array): Promise<{
  texto: string;
  paginas: string[];
  totalPages: number;
}> {
  const { extractText, extractTextItems } = await import("unpdf");
  const extraido = await extractText(bytes, { mergePages: false });
  let paginas = extraido.text;

  try {
    const estruturado = await extractTextItems(bytes);
    if (estruturado.items.length > 0) {
      paginas = estruturado.items.map((itens, indice) => {
        const visuais = linhas_visuais_pdf(itens);
        if (visuais.length > 0) return visuais.join("\n");
        return extraido.text[indice] ?? "";
      });
    }
  } catch {
    // PDF.js às vezes falha nos itens; o texto corrido ainda serve ao parser.
  }

  return {
    texto: paginas.join("\n"),
    paginas,
    totalPages: extraido.totalPages,
  };
}

export async function interpretar_linhas_pdf(
  texto: string,
  paginas?: string[],
  orquestrador: OrquestradorIA = new OrquestradorIA(),
): Promise<LinhaExtraidaPdf[]> {
  const corpus = paginas && paginas.length > 0 ? paginas.join("\n") : texto;
  const peloTexto = extrair_lancamentos_do_texto(corpus);
  if (peloTexto.length > 0) return peloTexto.map(enriquecer_linha_pdf);

  const lotes = lotes_texto_pdf(
    paginas && paginas.length > 0 ? paginas : [texto],
    LIMITE_CARACTERES_LOTE,
  );
  if (lotes.length === 0) return [];

  try {
    const extraidos: LinhaExtraidaPdf[][] = [];
    for (let i = 0; i < lotes.length; i++) {
      extraidos.push(await interpretar_lote_pdf(lotes[i]!, i + 1, lotes.length, orquestrador));
    }
    return unir_linhas_extraidas(extraidos).map(enriquecer_linha_pdf);
  } catch {
    // Preview não pode cair com 503: parser vazio + IA fora → lista vazia e aviso no modal.
    return [];
  }
}

async function interpretar_lote_pdf(
  trecho: string,
  indice: number,
  total: number,
  orquestrador: OrquestradorIA,
): Promise<LinhaExtraidaPdf[]> {
  const objeto = await orquestrador.gerar_objeto_estruturado({
    schema: schemaObjetoLinhas,
    estagio: "extrair_fatura_pdf",
    system: [
      "Você extrai lançamentos de fatura ou extrato em PDF.",
      "Cada linha é uma movimentação: data, descrição, valor positivo, tipo (receita ou despesa) e destinoSugerido.",
      "destinoSugerido=cartao para compra no cartão, fatura, parcela, 'card payment', estabelecimento.",
      "destinoSugerido=conta para TED, PIX, transferência, ATM, câmbio, salário, 'To ', 'From '.",
      "Valor sempre positivo. Despesa = dinheiro saindo; receita = entrando.",
      "ocorridoEm no formato YYYY-MM-DD.",
      "Se a descrição tiver parcela (ex.: 3/12), preencha parcelamento {numero, total}.",
      "Ignore totais, saldos, cabeçalhos e anúncios.",
      "Extraia TODAS as movimentações deste trecho, inclusive as do final. Não resuma nem omita linhas.",
      "Responda só o JSON pedido.",
    ].join(" "),
    prompt: `Trecho ${indice}/${total} do PDF:\n\n${trecho}\n\nDevolva {"linhas":[{"ocorridoEm":"YYYY-MM-DD","descricao":"...","valor":0.0,"tipo":"despesa","destinoSugerido":"conta"}]}`,
  });

  return objeto.linhas;
}

async function garantir_categoria_nao_classificado(usuarioId: string): Promise<string> {
  const banco = obter_banco();
  const [existente] = await banco
    .select({ id: categoriaTabela.id })
    .from(categoriaTabela)
    .where(
      and(
        eq(categoriaTabela.usuarioId, usuarioId),
        eq(categoriaTabela.nome, CATEGORIA_NAO_CLASSIFICADO),
      ),
    )
    .limit(1);
  if (existente) return existente.id;

  const [criada] = await banco
    .insert(categoriaTabela)
    .values({
      nome: CATEGORIA_NAO_CLASSIFICADO,
      tipo: "ambos",
      usuarioId,
    })
    .returning({ id: categoriaTabela.id });
  if (!criada) throw new Error("Não foi possível criar a categoria de não classificado.");
  return criada.id;
}

async function carregar_origem(entrada: {
  usuarioId: string;
  contaId?: string;
  cartaoId?: string;
}): Promise<{ origem: DestinoPdf; sincronizada: boolean }> {
  if (Boolean(entrada.contaId) === Boolean(entrada.cartaoId)) {
    throw new ErroValidacaoFinanceira("Informe a conta ou o cartão de origem — só um dos dois.");
  }
  const banco = obter_banco();
  if (entrada.contaId) {
    const [linha] = await banco
      .select()
      .from(contaTabela)
      .where(and(eq(contaTabela.id, entrada.contaId), eq(contaTabela.usuarioId, entrada.usuarioId)))
      .limit(1);
    if (!linha || !linha.ativo) throw new ErroRecursoNaoEncontrado("conta", entrada.contaId);
    exigir_destino_manual(linha);
    return {
      origem: { tipo: "conta", id: linha.id, nome: linha.nome },
      sincronizada: linha.sincronizada,
    };
  }
  const cartaoId = entrada.cartaoId!;
  const [linha] = await banco
    .select()
    .from(cartaoTabela)
    .where(and(eq(cartaoTabela.id, cartaoId), eq(cartaoTabela.usuarioId, entrada.usuarioId)))
    .limit(1);
  if (!linha || !linha.ativo) throw new ErroRecursoNaoEncontrado("cartao", cartaoId);
  exigir_destino_manual(linha);
  return {
    origem: { tipo: "cartao", id: linha.id, nome: linha.nome },
    sincronizada: linha.sincronizada,
  };
}

async function listar_candidatos(usuarioId: string): Promise<{
  contas: CandidatoDestinoPdf[];
  cartoes: CandidatoDestinoPdf[];
}> {
  const banco = obter_banco();
  const [contas, cartoes] = await Promise.all([
    banco
      .select({
        id: contaTabela.id,
        nome: contaTabela.nome,
        sincronizada: contaTabela.sincronizada,
      })
      .from(contaTabela)
      .where(and(eq(contaTabela.usuarioId, usuarioId), eq(contaTabela.ativo, true))),
    banco
      .select({
        id: cartaoTabela.id,
        nome: cartaoTabela.nome,
        sincronizada: cartaoTabela.sincronizada,
        contaId: cartaoTabela.contaId,
      })
      .from(cartaoTabela)
      .where(and(eq(cartaoTabela.usuarioId, usuarioId), eq(cartaoTabela.ativo, true))),
  ]);
  return {
    contas: contas.map((conta) => ({ tipo: "conta" as const, ...conta })),
    cartoes: cartoes.map((cartao) => ({ tipo: "cartao" as const, ...cartao })),
  };
}

export async function preview_importacao_pdf(entrada: {
  usuarioId: string;
  contaId?: string;
  cartaoId?: string;
  arquivo: Uint8Array;
  nomeArquivo?: string;
  extrairTexto?: (bytes: Uint8Array) => Promise<{ texto: string; paginas?: string[]; totalPages?: number }>;
  interpretarLinhas?: (texto: string, paginas?: string[]) => Promise<LinhaExtraidaPdf[]>;
}): Promise<PreviewImportacaoPdf> {
  if (entrada.arquivo.byteLength === 0) {
    throw new ErroValidacaoFinanceira("O arquivo PDF está vazio.");
  }
  if (entrada.arquivo.byteLength > LIMITE_ARQUIVO_BYTES) {
    throw new ErroValidacaoFinanceira("O PDF pode ter no máximo 12 MB.");
  }

  const { origem } = await carregar_origem(entrada);
  const { contas, cartoes } = await listar_candidatos(entrada.usuarioId);
  const arquivoHash = hash_bytes_arquivo(entrada.arquivo);
  const extrair = entrada.extrairTexto ?? extrair_texto_pdf;
  const { texto, paginas } = await extrair(entrada.arquivo);
  const textoInsuficiente = texto_pdf_insuficiente(texto);
  const provedor = provedor_pdf_do_texto(texto);

  if (textoInsuficiente) {
    return montar_preview_pdf({
      linhas: [],
      origem,
      contas,
      cartoes,
      arquivoHash,
      provedor,
      textoInsuficiente: true,
      aviso:
        "Este PDF parece ser só imagem (escaneado). Na v1 só importamos fatura digital com texto selecionável.",
    });
  }

  const interpretar = entrada.interpretarLinhas ?? interpretar_linhas_pdf;
  const corpus = paginas && paginas.length > 0 ? paginas.join("\n") : texto;
  let linhas: LinhaExtraidaPdf[] = [];
  try {
    linhas = await interpretar(texto, paginas);
  } catch {
    linhas = extrair_lancamentos_do_texto(corpus).map(enriquecer_linha_pdf);
  }

  return montar_preview_pdf({
    linhas,
    origem,
    contas,
    cartoes,
    arquivoHash,
    provedor,
    textoInsuficiente: false,
    aviso:
      linhas.length === 0
        ? "Não encontramos lançamentos neste PDF. Confira se datas e valores estão como texto selecionável."
        : undefined,
  });
}

const schemaDestinoConfirmacao = z.object({
  tipo: z.enum(["conta", "cartao"]),
  id: z.string().uuid(),
  nome: z.string().min(1),
});

export const schemaConfirmarImportacaoPdf = z.object({
  usuarioId: z.string().uuid(),
  arquivoHash: z.string().regex(/^[a-f0-9]{64}$/i),
  provedor: z.enum(["pdf", "revolut-pdf"]),
  linhas: z
    .array(
      z.object({
        ocorridoEm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        descricao: z.string().min(1),
        valor: z.number().positive(),
        tipo: z.enum(["receita", "despesa"]),
        destinoSugerido: z.enum(["conta", "cartao"]),
        destino: schemaDestinoConfirmacao,
        parcelamento: parcelamentoFonteSchema.optional(),
      }),
    )
    .min(1),
});

export type EntradaConfirmarImportacaoPdf = z.infer<typeof schemaConfirmarImportacaoPdf>;

async function carregar_destinos_confirmacao(
  usuarioId: string,
  destinos: Array<{ tipo: TipoDestinoPdf; id: string }>,
): Promise<
  Array<{
    tipo: TipoDestinoPdf;
    id: string;
    workspaceId: string;
    sincronizada: boolean;
    nome: string;
  }>
> {
  const banco = obter_banco();
  const contaIds = destinos.filter((d) => d.tipo === "conta").map((d) => d.id);
  const cartaoIds = destinos.filter((d) => d.tipo === "cartao").map((d) => d.id);
  const resultado: Array<{
    tipo: TipoDestinoPdf;
    id: string;
    workspaceId: string;
    sincronizada: boolean;
    nome: string;
  }> = [];

  if (contaIds.length > 0) {
    const contas = await banco
      .select()
      .from(contaTabela)
      .where(
        and(
          eq(contaTabela.usuarioId, usuarioId),
          eq(contaTabela.ativo, true),
          inArray(contaTabela.id, contaIds),
        ),
      );
    for (const conta of contas) {
      exigir_destino_manual(conta);
      resultado.push({
        tipo: "conta",
        id: conta.id,
        workspaceId: conta.workspaceId,
        sincronizada: conta.sincronizada,
        nome: conta.nome,
      });
    }
  }
  if (cartaoIds.length > 0) {
    const cartoes = await banco
      .select()
      .from(cartaoTabela)
      .where(
        and(
          eq(cartaoTabela.usuarioId, usuarioId),
          eq(cartaoTabela.ativo, true),
          inArray(cartaoTabela.id, cartaoIds),
        ),
      );
    for (const cartao of cartoes) {
      exigir_destino_manual(cartao);
      resultado.push({
        tipo: "cartao",
        id: cartao.id,
        workspaceId: cartao.workspaceId,
        sincronizada: cartao.sincronizada,
        nome: cartao.nome,
      });
    }
  }

  const idsEncontrados = new Set(resultado.map((item) => item.id));
  for (const pedido of destinos) {
    if (!idsEncontrados.has(pedido.id)) {
      throw new ErroRecursoNaoEncontrado(pedido.tipo, pedido.id);
    }
  }
  return resultado;
}

function dia_iso_pdf(valor: string | Date | null | undefined): string | null {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    const y = valor.getFullYear();
    const m = String(valor.getMonth() + 1).padStart(2, "0");
    const d = String(valor.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return data_iso_parcela(valor);
}

function serie_parcela_do_evento(evento: EventoFinanceiroNormalizado): ParcelaSerieEntrada | null {
  const parcela = evento.parcelamento;
  if (!evento.cartaoId || !parcela || parcela.total < 2) return null;
  const dataMovimento = dia_iso_pdf(evento.ocorridoEm) ?? evento.ocorridoEm;
  const compraEm =
    dia_iso_pdf(parcela.compraEm) ?? estimar_compra_em_parcela(dataMovimento, parcela.numero);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(compraEm) || !/^\d{4}-\d{2}-\d{2}$/.test(dataMovimento)) {
    return null;
  }
  return {
    parcelaNumero: parcela.numero,
    parcelaTotal: parcela.total,
    parcelaCompraEm: compraEm,
    parcelaCompraValor: parcela.valorTotal != null ? Number(parcela.valorTotal).toFixed(2) : null,
    valor: evento.valor,
    dataMovimento,
    descricao: evento.descricaoFonte,
    idExterno: evento.idExterno ?? null,
    status: evento.statusFonte === "pendente" ? "previsto" : "realizado",
    statusFonte: evento.statusFonte ?? "confirmado",
  };
}

function serie_parcela_do_movimento(movimento: {
  parcelaNumero: number | null;
  parcelaTotal: number | null;
  parcelaCompraEm: string | Date | null;
  parcelaCompraValor: string | number | null;
  valor: string | number;
  dataMovimento: string | Date;
  descricao: string;
  idExterno: string | null;
  status: string;
  statusFonte: string | null;
}): ParcelaSerieEntrada | null {
  if (movimento.parcelaNumero == null || movimento.parcelaTotal == null || movimento.parcelaTotal < 2) {
    return null;
  }
  const dataMovimento =
    dia_iso_pdf(movimento.dataMovimento) ?? String(movimento.dataMovimento).slice(0, 10);
  const compraEm =
    dia_iso_pdf(movimento.parcelaCompraEm) ??
    estimar_compra_em_parcela(dataMovimento, movimento.parcelaNumero);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(compraEm) || !/^\d{4}-\d{2}-\d{2}$/.test(dataMovimento)) {
    return null;
  }
  return {
    parcelaNumero: movimento.parcelaNumero,
    parcelaTotal: movimento.parcelaTotal,
    parcelaCompraEm: compraEm,
    parcelaCompraValor:
      movimento.parcelaCompraValor == null ? null : String(movimento.parcelaCompraValor),
    valor: movimento.valor,
    dataMovimento,
    descricao: movimento.descricao,
    idExterno: movimento.idExterno,
    status: movimento.status,
    statusFonte: movimento.statusFonte,
  };
}

function chave_serie_parcela(serie: ParcelaSerieEntrada): string {
  return [serie.parcelaNumero, serie.parcelaTotal, serie.parcelaCompraEm, serie.idExterno ?? ""].join("|");
}

async function completar_parcelas_futuras_pdf(entrada: {
  motor: MotorFinanceiro;
  eventos: EventoFinanceiroNormalizado[];
  usuarioId: string;
  categoriaIdNaoClassificado: string;
  provedor: string;
}): Promise<{ criados: number; duplicados: number; ids: string[] }> {
  const cartoes = [
    ...new Map(
      entrada.eventos
        .filter((evento) => evento.cartaoId && evento.parcelamento && evento.parcelamento.total >= 2)
        .map((evento) => [evento.cartaoId!, evento]),
    ).values(),
  ];
  if (cartoes.length === 0) {
    return { criados: 0, duplicados: 0, ids: [] };
  }

  const projetados: EventoFinanceiroNormalizado[] = [];
  for (const evento of cartoes) {
    const cartaoId = evento.cartaoId!;
    const porChave = new Map<string, ParcelaSerieEntrada>();
    const doBanco = await entrada.motor.listar_movimentos_parcelados_do_cartao(cartaoId);
    for (const movimento of doBanco) {
      const serie = serie_parcela_do_movimento(movimento);
      if (!serie) continue;
      porChave.set(chave_serie_parcela(serie), serie);
    }
    for (const candidato of entrada.eventos.filter((item) => item.cartaoId === cartaoId)) {
      const serie = serie_parcela_do_evento(candidato);
      if (!serie) continue;
      porChave.set(chave_serie_parcela(serie), serie);
    }
    projetados.push(
      ...planejar_complemento_parcelas_cartao({
        workspaceId: evento.workspaceId,
        cartaoId,
        fonte: "pdf",
        provedor: entrada.provedor,
        preservarDia: true,
        movimentos: [...porChave.values()],
      }),
    );
  }

  if (projetados.length === 0) {
    return { criados: 0, duplicados: 0, ids: [] };
  }

  const resultado = await entrada.motor.ingerir_eventos(projetados, {
    usuarioId: entrada.usuarioId,
    criadoPor: entrada.usuarioId,
    categoriaIdNaoClassificado: entrada.categoriaIdNaoClassificado,
    perfilPadrao: "pf",
  });
  return {
    criados: resultado.criados.length,
    duplicados: resultado.duplicados,
    ids: resultado.criados.map((movimento) => movimento.id),
  };
}

export async function confirmar_importacao_pdf(
  entradaBruta: EntradaConfirmarImportacaoPdf,
  deps: {
    motor?: MotorFinanceiro;
    enriquecer?: typeof enriquecer_apos_ingestao;
    log: FastifyBaseLogger;
  },
): Promise<{ criados: number; duplicados: number }> {
  const entrada = schemaConfirmarImportacaoPdf.parse(entradaBruta);
  const destinosUnicos = [
    ...new Map(entrada.linhas.map((linha) => [linha.destino.id, linha.destino])).values(),
  ];
  const destinos = await carregar_destinos_confirmacao(entrada.usuarioId, destinosUnicos);
  const eventos = montar_eventos_pdf({
    linhas: entrada.linhas as LinhaConfirmacaoPdf[],
    destinos,
    arquivoHash: entrada.arquivoHash.toLowerCase(),
    provedor: entrada.provedor,
  });

  const categoriaIdNaoClassificado = await garantir_categoria_nao_classificado(entrada.usuarioId);
  const motor = deps.motor ?? new MotorFinanceiro(new RepositorioFinanceiroDrizzle());
  const contexto = {
    usuarioId: entrada.usuarioId,
    criadoPor: entrada.usuarioId,
    categoriaIdNaoClassificado,
    perfilPadrao: "pf" as const,
  };
  const resultado = await motor.ingerir_eventos(eventos, contexto);

  const comParcela = eventos.filter(
    (evento) => evento.parcelamento && evento.parcelamento.total >= 2 && evento.idExterno,
  );
  if (comParcela.length > 0) {
    // Reimportação: o 1/4 antigo entra como duplicata sem as colunas de parcela.
    await motor.atualizar_fatos_da_fonte(comParcela, contexto);
  }

  const projetados = await completar_parcelas_futuras_pdf({
    motor,
    eventos,
    usuarioId: entrada.usuarioId,
    categoriaIdNaoClassificado,
    provedor: entrada.provedor,
  });

  const resumo: ResumoIngestao = {
    criados: resultado.criados.length + projetados.criados,
    duplicados: resultado.duplicados + projetados.duplicados,
    atualizados: 0,
    removidos: 0,
    semDestino: 0,
    puladosSemanticos: 0,
    paginas: 0,
    movimentoIdsCriados: [
      ...resultado.criados.map((movimento) => movimento.id),
      ...projetados.ids,
    ],
  };

  const enriquecer = deps.enriquecer ?? enriquecer_apos_ingestao;
  await enriquecer({
    eventoId: `pdf:${entrada.arquivoHash.slice(0, 12)}`,
    resumo,
    log: deps.log,
  });

  deps.log.info(
    { criados: resumo.criados, duplicados: resumo.duplicados, eventoId: `pdf:${entrada.arquivoHash.slice(0, 12)}` },
    "[pdf] ingestão de fatura",
  );

  return { criados: resumo.criados, duplicados: resumo.duplicados };
}
