/**
 * Tira prefixos descartáveis do extrato (Pix, TED, QR) da descrição que a
 * pessoa vê. O Fato (`descricaoFonte`) permanece o texto da instituição.
 *
 * Só casa o começo da linha. Não apaga "pix" no meio de um nome.
 */

const PREFIXOS = [
  "Pagamento com QR Pix",
  "Pagamento QR Pix",
  "Transferência Pix enviada",
  "Transferência Pix recebida",
  "Pix recebido",
  "Pix enviado",
  "Transferência Pix",
  "TED recebida",
  "TED enviada",
  "Transferência recebida",
  "Transferência enviada",
  "TED",
] as const;

function dobrar(token: string): string {
  return token
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

function tokens_de(texto: string): string[] {
  return texto.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
}

const PREFIXOS_EM_TOKENS = [...PREFIXOS]
  .map((prefixo) => tokens_de(prefixo))
  .sort((a, b) => b.length - a.length || b.join(" ").length - a.join(" ").length);

function casa_prefixo(tokens: string[], prefixo: string[]): boolean {
  if (tokens.length < prefixo.length) return false;
  return prefixo.every((parte, indice) => dobrar(tokens[indice]!) === dobrar(parte));
}

function colapsar_linha(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

/**
 * Descrição de Conhecimento a partir do texto da fonte: uma linha, sem o
 * prefixo operacional. Prefixo sozinho (resto vazio) permanece o original
 * colapsado — não apaga a célula.
 */
export function enxugar_descricao_fonte(texto: string): string {
  const linha = colapsar_linha(texto);
  if (!linha) return linha;

  const tokens = tokens_de(linha);
  for (const prefixo of PREFIXOS_EM_TOKENS) {
    if (!casa_prefixo(tokens, prefixo)) continue;
    const resto = tokens.slice(prefixo.length).join(" ");
    return resto || linha;
  }

  return linha;
}

/**
 * A descrição ainda é a cópia automática da fonte (bruta ou já enxuta), não
 * um nome que a pessoa escolheu.
 */
export function descricao_ainda_automatica(descricao: string, descricaoFonte: string): boolean {
  return descricao === descricaoFonte || descricao === enxugar_descricao_fonte(descricaoFonte);
}
