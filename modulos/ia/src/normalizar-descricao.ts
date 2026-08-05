/** Normaliza descrição para comparar possíveis duplicatas (caixa e acentos). */
export function normalizar_descricao(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokens que nunca entram na descrição (forma de pagamento, meta, vocativo). */
const RUIDO_DESCRICAO = new Set([
  "pix",
  "ted",
  "doc",
  "boleto",
  "transferencia",
  "transferencias",
  "dinheiro",
  "credito",
  "debito",
  "valor",
  "reais",
  "real",
  "especie",
  "via",
  "lancai",
  "lancay",
  "lanc",
  "um",
  "uma",
  "uns",
  "umas",
  "o",
  "a",
  "os",
  "as",
  "de",
  "do",
  "da",
  "dos",
  "das",
  "para",
  "pra",
  "com",
  "no",
  "na",
  "nos",
  "nas",
  "em",
  "meu",
  "minha",
]);

/**
 * Enxuga descrição de lançamento: tira fluff da IA/usuário/STT e deixa o núcleo
 * (ex.: "Lanç í tênis Adidas Pix valor" → "Tênis Adidas").
 */
export function enxugar_descricao_lancamento(texto: string): string {
  let s = limpar_termo_descricao(texto);
  if (!s) return texto.trim() || "Lançamento";

  // Vocativo do bot / STT (LançAI → "lanç í", "lancai", "oi lançai"…).
  // Evita \b após acentos: em JS, í/ç não são \w.
  s = s.replace(
    /(?:^|\s)(?:(?:oi|ol[aá]|hey|e\s*a[ií])\s+)?lan[cç](?:ai|ay|a[ií]|[\s\-]+[ií])(?=\s|$)/gi,
    " ",
  );
  s = s.replace(/(?:^|\s)lan\s*cai(?=\s|$)/gi, " ");

  // Perfil / intenção — nunca fazem parte da descrição.
  s = s.replace(
    /\b(para\s+)?uso\s+pessoal\b|\bgasto\s+pessoal\b|\bganho\s+pessoal\b|\bum\s+gasto\s+pessoal\b|\bda\s+empresa\b|\bpara\s+(a\s+)?empresa\b|\buso\s+(da\s+)?empresa\b|\bgasto\s+(da\s+)?empresa\b|\bpessoalmente\b|\bempresarial(?:mente)?\b/gi,
    " ",
  );

  // Forma de pagamento em locuções ("no pix", "via transferência").
  s = s.replace(
    /\b(?:via|no|na|por|pelo|pela)?\s*(?:pix|ted|doc|boleto|transfer[eê]ncias?|dinheiro|esp[eé]cie|cr[eé]dito|d[eé]bito)\b/gi,
    " ",
  );

  // Meta financeira solta.
  s = s.replace(/\b(?:valor|reais?|r\$)\b/gi, " ");

  // Verbos / moldura — com ou sem preposição ("comprei tênis" / "compra de um tênis").
  s = s.replace(
    /\b(compra|comprei|gastei|paguei|pague|recebi|ganhei|debitei)(?:\s+(?:de|do|da|dos|das|com|no|na|nos|nas|em|um|uma))?\b/gi,
    " ",
  );

  // Artigos / conectores / ruído por token (não \b): em JS, ç/ã não são \w.
  s = s.replace(/^[,\s]+|[,\s]+$/g, "");
  s = s.replace(/\s*,\s*/g, " ");
  s = s
    .split(/\s+/)
    .filter((p) => {
      const n = normalizar_descricao(p);
      return n.length > 1 && !RUIDO_DESCRICAO.has(n);
    })
    .join(" ")
    .trim();

  // Se sobrou só lixo, cai no original limpo curto.
  if (!s || s.length < 2) {
    s = limpar_termo_descricao(texto).replace(/\s+/g, " ").trim() || "Lançamento";
  }

  // Capitaliza primeira letra (mantém resto).
  return s.charAt(0).toLocaleUpperCase("pt-BR") + s.slice(1);
}

/** Chave canônica para comparar duplicatas após enxugar. */
export function chave_descricao_lancamento(texto: string): string {
  return normalizar_descricao(enxugar_descricao_lancamento(texto));
}

/** Mantém só letras latinas (pt-BR), números e espaços — descarta lixo da IA. */
export function limpar_termo_descricao(texto: string): string {
  return texto
    .replace(/[^\p{Script=Latin}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupe_palavras_rotulo(texto: string): string {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const palavra of texto.split(/\s+/).filter(Boolean)) {
    const chave = normalizar_descricao(palavra);
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(palavra);
  }
  return saida.join(" ");
}

/** Extrai um rótulo legível quando a IA manda alternativas ("Farmácia/Farmacia"). */
export function rotulo_descricao_busca(texto?: string | null): string {
  if (!texto?.trim()) return "não especificado";
  const enxuto = enxugar_descricao_lancamento(texto);
  if (enxuto && enxuto.toLocaleLowerCase("pt-BR") !== "lançamento") return enxuto;

  const partes = texto
    .split(/[\/|,;]+|\bou\b/i)
    .map((parte) => dedupe_palavras_rotulo(limpar_termo_descricao(parte)))
    .filter((parte) => parte.length >= 2)
    .sort((a, b) => a.length - b.length || a.localeCompare(b, "pt-BR"));
  return partes[0] ?? (dedupe_palavras_rotulo(limpar_termo_descricao(texto)) || texto.trim() || "não especificado");
}

const STOPWORDS_BUSCA = new Set([
  "de",
  "da",
  "do",
  "das",
  "dos",
  "um",
  "uma",
  "uns",
  "umas",
  "o",
  "a",
  "os",
  "as",
  "para",
  "com",
  "no",
  "na",
  "nos",
  "nas",
  "em",
  "uso",
  "pessoal",
  "empresa",
  "compra",
  "comprei",
  "gastei",
  "paguei",
  "lancamento",
  "lancamentos",
  "despesa",
  "despesas",
  "gasto",
  "gastos",
]);

function tokens_significativos(texto: string): string[] {
  const base = normalizar_descricao(enxugar_descricao_lancamento(texto));
  return base
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS_BUSCA.has(t));
}

/**
 * Compara descrição cadastrada com o termo citado pelo usuário/IA.
 * Aceita "Farmácia" ≈ "farmacia", fluff ("compra de um tênis…") ≈ "tênis",
 * e alternativas tipo "Farmácia/Farmacia".
 */
export function descricao_corresponde_busca(cadastrada: string, citada: string): boolean {
  const chaveCad = chave_descricao_lancamento(cadastrada);
  const chaveCit = chave_descricao_lancamento(citada);
  if (chaveCad && chaveCit) {
    if (chaveCad === chaveCit || chaveCad.includes(chaveCit) || chaveCit.includes(chaveCad)) {
      return true;
    }
  }

  const tokensCit = tokens_significativos(citada);
  const tokensCad = new Set(tokens_significativos(cadastrada));
  if (tokensCit.length === 0) {
    // Fallback antigo (sem enxugar) para termos curtos tipo "99".
    const alvo = normalizar_descricao(cadastrada);
    const termo = normalizar_descricao(limpar_termo_descricao(citada));
    return Boolean(alvo && termo && (alvo === termo || alvo.includes(termo) || termo.includes(alvo)));
  }

  // Basta um token significativo da citação aparecer no cadastro (ex.: "tênis").
  return tokensCit.some((token) => tokensCad.has(token) || chaveCad.includes(token));
}
