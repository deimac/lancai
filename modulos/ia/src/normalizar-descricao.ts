/** Normaliza descrição para comparar possíveis duplicatas (caixa e acentos). */
export function normalizar_descricao(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Enxuga descrição de lançamento: tira fluff da IA/usuário e deixa o núcleo
 * (ex.: "compra de um tênis para uso pessoal" → "Tênis").
 */
export function enxugar_descricao_lancamento(texto: string): string {
  let s = limpar_termo_descricao(texto);
  if (!s) return texto.trim() || "Lançamento";

  // Perfil / intenção — nunca fazem parte da descrição.
  s = s.replace(
    /\b(para\s+)?uso\s+pessoal\b|\bgasto\s+pessoal\b|\bganho\s+pessoal\b|\bum\s+gasto\s+pessoal\b|\bda\s+empresa\b|\bpara\s+(a\s+)?empresa\b|\buso\s+(da\s+)?empresa\b|\bgasto\s+(da\s+)?empresa\b|\bpessoalmente\b|\bempresarial(?:mente)?\b/gi,
    " ",
  );

  // Verbos / moldura de frase.
  s = s.replace(
    /\b(compra|comprei|gastei|paguei|pague|paguei|recebi|ganhei|debitei)\s+(de|do|da|dos|das|com|no|na|nos|nas|em|um|uma)?\b/gi,
    " ",
  );
  s = s.replace(/\b(compra|comprei)\s+(de|do|da|dos|das)\b/gi, " ");

  // Artigos / conectores soltos no início/meio após limpeza.
  s = s.replace(/^[,\s]+|[,\s]+$/g, "");
  s = s.replace(/\s*,\s*/g, " ");
  s = s.replace(/\b(um|uma|uns|umas|o|a|os|as|de|do|da|dos|das)\b/gi, " ");
  s = s.replace(/\s+/g, " ").trim();

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
  const partes = texto
    .split(/[\/|,;]+|\bou\b/i)
    .map((parte) => dedupe_palavras_rotulo(limpar_termo_descricao(parte)))
    .filter((parte) => parte.length >= 2)
    // Prefere o termo mais curto e natural ("farmacia" > "farmaciarole").
    .sort((a, b) => a.length - b.length || a.localeCompare(b, "pt-BR"));
  return partes[0] ?? (dedupe_palavras_rotulo(limpar_termo_descricao(texto)) || texto.trim() || "não especificado");
}

/**
 * Compara descrição cadastrada com o termo citado pelo usuário/IA.
 * Aceita "Farmácia" ≈ "farmacia" e alternativas tipo "Farmácia/Farmacia".
 */
export function descricao_corresponde_busca(cadastrada: string, citada: string): boolean {
  const alvo = normalizar_descricao(cadastrada);
  if (!alvo) return false;

  const partes = citada
    .split(/[\/|,;]+/)
    .map((parte) => normalizar_descricao(limpar_termo_descricao(parte)))
    .filter((parte) => parte.length >= 2);

  const candidatos =
    partes.length > 0 ? partes : [normalizar_descricao(limpar_termo_descricao(citada))].filter(Boolean);
  return candidatos.some(
    (termo) => alvo === termo || alvo.includes(termo) || termo.includes(alvo),
  );
}
