import { createHash } from "node:crypto";
import { ErroValidacaoFinanceira } from "@lancai/financeiro";
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

export function rotear_linhas_pdf(
  linhas: LinhaExtraidaPdf[],
  contexto: { origem: DestinoPdf; par: DestinoPdf | null },
): LinhaPreviewPdf[] {
  return linhas.map((linha) => {
    if (linha.destinoSugerido === contexto.origem.tipo) {
      return { ...linha, destino: contexto.origem, aceita: true };
    }
    if (contexto.par && linha.destinoSugerido === contexto.par.tipo) {
      return { ...linha, destino: contexto.par, aceita: true };
    }
    return { ...linha, destino: contexto.origem, aceita: true };
  });
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
  const precisaSegundoDestino =
    !entrada.textoInsuficiente &&
    par == null &&
    candidatosPar.length > 0 &&
    linhas.some((linha) => linha.destinoSugerido !== entrada.origem.tipo);

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
