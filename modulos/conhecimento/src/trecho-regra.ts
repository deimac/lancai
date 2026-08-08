/**
 * Palavras que aparecem em extrato e não identificam estabelecimento.
 * Casar regra nelas criaria falsos positivos em quase todo lançamento.
 */
const RUIDO = new Set([
  "pag",
  "pagamento",
  "compra",
  "pix",
  "ted",
  "doc",
  "transferencia",
  "transferência",
  "debito",
  "débito",
  "credito",
  "crédito",
  "prov",
  "provisorio",
  "provisório",
  "cartao",
  "cartão",
  "visa",
  "master",
  "elo",
  "saque",
  "tarifa",
  "taxa",
  "pgto",
  "pagto",
]);

/**
 * Propõe o trecho que uma regra `descricao_contem` deve procurar, a partir do
 * texto do lançamento. Preferência: favorecido da instituição, depois o primeiro
 * token útil da descrição da fonte, depois da descrição do usuário.
 *
 * Devolve o trecho em maiúsculas para a oferta ficar legível ("IFOOD"), e a
 * comparação na aplicação continua sem distinção de maiúscula.
 */
export function propor_trecho_regra(movimento: {
  descricao: string;
  descricaoFonte: string;
  favorecidoFonte?: string | null;
}): string | null {
  const candidatos: string[] = [];

  if (movimento.favorecidoFonte?.trim()) {
    candidatos.push(movimento.favorecidoFonte.trim());
  }
  candidatos.push(...tokens_uteis(movimento.descricaoFonte));
  candidatos.push(...tokens_uteis(movimento.descricao));

  for (const candidato of candidatos) {
    const normalizado = candidato.toLocaleLowerCase("pt-BR");
    if (normalizado.length < 3) continue;
    if (RUIDO.has(normalizado)) continue;
    if (/^\d+$/.test(normalizado)) continue;
    return candidato.toLocaleUpperCase("pt-BR");
  }

  return null;
}

function tokens_uteis(texto: string): string[] {
  return texto
    .split(/[^A-Za-zÀ-ÿ0-9]+/u)
    .map((parte) => parte.trim())
    .filter(Boolean);
}
