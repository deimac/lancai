import { enxugar_indice_parcela, normalizar_descricao_parcela } from "@lancai/tipos";

const RUIDO = new Set([
  "pag",
  "pagamento",
  "compra",
  "pix",
  "ted",
  "doc",
  "transferencia",
  "debito",
  "credito",
  "prov",
  "provisorio",
  "cartao",
  "visa",
  "master",
  "elo",
  "saque",
  "tarifa",
  "taxa",
  "pgto",
  "pagto",
  "enviado",
  "enviada",
  "recebido",
  "recebida",
  "qr",
]);

export function chave_classificacao_igual(texto: string): string {
  const limpo = enxugar_indice_parcela(texto).replace(/[^\p{L}\p{N}\s]+/gu, " ");
  return normalizar_descricao_parcela(limpo);
}

export function eh_chave_classificacao_generica(chave: string): boolean {
  const tokens = chave.split(" ").filter(Boolean);
  if (tokens.length === 0) return true;
  if (chave.length < 4) return true;
  return tokens.every((token) => RUIDO.has(token) || token.length < 3 || /^\d+$/.test(token));
}

export function movimento_igual_para_classificar(
  ancora: { descricao: string; descricaoFonte: string },
  outro: { descricao: string; descricaoFonte: string },
): boolean {
  const descricaoAncora = chave_classificacao_igual(ancora.descricao);
  const descricaoOutro = chave_classificacao_igual(outro.descricao);
  if (
    descricaoAncora &&
    descricaoOutro &&
    descricaoAncora === descricaoOutro &&
    !eh_chave_classificacao_generica(descricaoAncora)
  ) {
    return true;
  }
  const fonteAncora = chave_classificacao_igual(ancora.descricaoFonte);
  const fonteOutro = chave_classificacao_igual(outro.descricaoFonte);
  return Boolean(
    fonteAncora &&
      fonteOutro &&
      fonteAncora === fonteOutro &&
      !eh_chave_classificacao_generica(fonteAncora),
  );
}
