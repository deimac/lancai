/**
 * Extrai o primeiro nome para tom pessoal nas perguntas do bot.
 */
export function primeiro_nome(nomeCompleto: string | null | undefined): string | null {
  if (!nomeCompleto?.trim()) return null;
  const primeiro = nomeCompleto.trim().split(/\s+/)[0]!;
  if (primeiro.length < 2) return null;
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLocaleLowerCase("pt-BR");
}

/**
 * Prefixa a pergunta com o nome ("Deividy, qual é o valor?") quando disponível.
 * Não duplica se a pergunta já começa com o nome.
 */
export function personalizar_pergunta(
  pergunta: string,
  nomeCompleto: string | null | undefined,
): string {
  const texto = pergunta.trim();
  if (!texto) return pergunta;

  const nome = primeiro_nome(nomeCompleto);
  if (!nome) return texto;

  const inicio = texto.slice(0, nome.length).toLocaleLowerCase("pt-BR");
  if (inicio === nome.toLocaleLowerCase("pt-BR")) return texto;

  const resto = texto.charAt(0).toLocaleLowerCase("pt-BR") + texto.slice(1);
  return `${nome}, ${resto}`;
}

/**
 * Pergunta curta de slot-filling — um campo por vez.
 * Ex.: "Qual é o valor?" → "Deividy, qual é o valor?"
 */
export function perguntar_campo(
  perguntaCurta: string,
  nomeCompleto?: string | null,
): string {
  const texto = perguntaCurta.trim();
  if (!texto) return "Pode me dar mais detalhes?";
  const comPonto = /[?!.]$/.test(texto) ? texto : `${texto}?`;
  return personalizar_pergunta(comPonto, nomeCompleto);
}
