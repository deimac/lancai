/**
 * Onde a movimentação vinda de uma Fonte pousa antes de o Conhecimento
 * classificá-la. Não é "Outros": "Outros" é escolha do usuário, esta é a
 * ausência de escolha. Juntar as duas tornaria impossível listar o que ainda
 * falta classificar.
 */
export const CATEGORIA_NAO_CLASSIFICADO = "Não classificado";

/**
 * Categoria sistema da quitação de fatura. Não é um gasto novo: o Conhecimento
 * marca o papel `pagamento_fatura` e esconde a linha dos totais.
 */
export const CATEGORIA_PAGAMENTO_FATURA = "Pagamento de fatura";

export function eh_categoria_sistema(nome: string): boolean {
  const normalizado = nome.toLocaleLowerCase("pt-BR");
  return (
    normalizado === CATEGORIA_NAO_CLASSIFICADO.toLocaleLowerCase("pt-BR") ||
    normalizado === CATEGORIA_PAGAMENTO_FATURA.toLocaleLowerCase("pt-BR")
  );
}

export type VisualCategoriaPadrao = {
  icone: string;
  cor: string;
};

const VISUAL_POR_NOME: Record<string, VisualCategoriaPadrao> = {
  [CATEGORIA_NAO_CLASSIFICADO.toLocaleLowerCase("pt-BR")]: { icone: "geral", cor: "neutro" },
  [CATEGORIA_PAGAMENTO_FATURA.toLocaleLowerCase("pt-BR")]: { icone: "fatura", cor: "azul" },
  alimentação: { icone: "restaurante", cor: "laranja" },
  combustível: { icone: "combustivel", cor: "ambar" },
  transporte: { icone: "carro", cor: "azul" },
  moradia: { icone: "casa", cor: "violeta" },
  saúde: { icone: "saude", cor: "rosa" },
  lazer: { icone: "lazer", cor: "turquesa" },
  assinaturas: { icone: "streaming", cor: "ardosia" },
  viagens: { icone: "viagem", cor: "azul" },
  educação: { icone: "educacao", cor: "verde" },
  impostos: { icone: "impostos", cor: "ambar" },
  salário: { icone: "salario", cor: "verde" },
  vendas: { icone: "vendas", cor: "verde" },
  "serviços prestados": { icone: "servicos", cor: "turquesa" },
  outros: { icone: "tag", cor: "neutro" },
};

export function visual_categoria_padrao(nome: string): VisualCategoriaPadrao {
  return VISUAL_POR_NOME[nome.toLocaleLowerCase("pt-BR")] ?? { icone: "geral", cor: "neutro" };
}

/** Categorias criadas no seed e no primeiro uso de cada usuário. */
export const CATEGORIAS_PADRAO = [
  { nome: CATEGORIA_NAO_CLASSIFICADO, tipo: "ambos" as const, ...visual_categoria_padrao(CATEGORIA_NAO_CLASSIFICADO) },
  { nome: CATEGORIA_PAGAMENTO_FATURA, tipo: "ambos" as const, ...visual_categoria_padrao(CATEGORIA_PAGAMENTO_FATURA) },
  { nome: "Alimentação", tipo: "despesa" as const, ...visual_categoria_padrao("Alimentação") },
  { nome: "Combustível", tipo: "despesa" as const, ...visual_categoria_padrao("Combustível") },
  { nome: "Transporte", tipo: "despesa" as const, ...visual_categoria_padrao("Transporte") },
  { nome: "Moradia", tipo: "despesa" as const, ...visual_categoria_padrao("Moradia") },
  { nome: "Saúde", tipo: "despesa" as const, ...visual_categoria_padrao("Saúde") },
  { nome: "Lazer", tipo: "despesa" as const, ...visual_categoria_padrao("Lazer") },
  { nome: "Assinaturas", tipo: "despesa" as const, ...visual_categoria_padrao("Assinaturas") },
  { nome: "Viagens", tipo: "despesa" as const, ...visual_categoria_padrao("Viagens") },
  { nome: "Educação", tipo: "despesa" as const, ...visual_categoria_padrao("Educação") },
  { nome: "Impostos", tipo: "despesa" as const, ...visual_categoria_padrao("Impostos") },
  { nome: "Salário", tipo: "receita" as const, ...visual_categoria_padrao("Salário") },
  { nome: "Vendas", tipo: "receita" as const, ...visual_categoria_padrao("Vendas") },
  { nome: "Serviços prestados", tipo: "receita" as const, ...visual_categoria_padrao("Serviços prestados") },
  { nome: "Outros", tipo: "ambos" as const, ...visual_categoria_padrao("Outros") },
];

export type CategoriaPadrao = (typeof CATEGORIAS_PADRAO)[number];
