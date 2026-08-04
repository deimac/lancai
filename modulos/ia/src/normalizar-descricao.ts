/** Normaliza descrição para comparar possíveis duplicatas (caixa e acentos). */
export function normalizar_descricao(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();
}

/** Mantém só letras latinas (pt-BR), números e espaços — descarta lixo da IA. */
function limpar_termo_descricao(texto: string): string {
  return texto
    .replace(/[^\p{Script=Latin}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extrai um rótulo legível quando a IA manda alternativas ("Farmácia/Farmacia"). */
export function rotulo_descricao_busca(texto?: string | null): string {
  if (!texto?.trim()) return "não especificado";
  const partes = texto
    .split(/[\/|,;]+/)
    .map((parte) => limpar_termo_descricao(parte))
    .filter((parte) => parte.length >= 2);
  return partes[0] ?? (limpar_termo_descricao(texto) || texto.trim());
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
