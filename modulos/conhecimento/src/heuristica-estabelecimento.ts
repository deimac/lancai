/**
 * Casa estabelecimento conhecido com o nome de uma categoria padrão do usuário.
 * Não inventa categoria: só sugere o nome; o Conhecimento resolve o id.
 */

const REGRAS: Array<{ categoria: string; padrao: RegExp }> = [
  {
    categoria: "Alimentação",
    padrao:
      /\b(ifood|i\s*food|rappi|mcdonald|burger\s*king|\bbk\b|starbucks|padaria|restaurante|lanchonete|pizza|outback|habib|madero|subway)\b/i,
  },
  {
    categoria: "Transporte",
    padrao: /\b(uber|99pop|99\s*app|cabify|indrive|99\s*taxi)\b/i,
  },
  {
    categoria: "Combustível",
    padrao: /\b(shell|ipiranga|petrobras|posto\b|raizen)\b/i,
  },
  {
    categoria: "Assinaturas",
    padrao:
      /\b(spotify|netflix|disney|hbo|prime\s*video|youtube\s*premium|apple\.com|icloud|google\s*one|\bclaro\b|\bvivo\b|\btim\b|microsoft\s*365)\b/i,
  },
  {
    categoria: "Saúde",
    padrao:
      /\b(farm[aá]cia|drogaraia|drogasil|pacheco|\braia\b|hospital|laborat[oó]rio|unimed|\bamil\b)\b/i,
  },
  {
    categoria: "Viagens",
    padrao: /\b(latam|\bgol\b|azul\s*linhas|booking|airbnb|decolar|\bhotel\b)\b/i,
  },
  {
    categoria: "Lazer",
    padrao: /\b(steam|playstation|\bxbox\b|cinema|ingresso)\b/i,
  },
];

export function sugerir_nome_categoria_estabelecimento(
  ...trechos: Array<string | null | undefined>
): string | null {
  const texto = trechos.filter(Boolean).join(" ");
  if (!texto.trim()) return null;
  for (const regra of REGRAS) {
    if (regra.padrao.test(texto)) return regra.categoria;
  }
  return null;
}
