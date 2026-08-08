/**
 * Onde a movimentação vinda de uma Fonte pousa antes de o Conhecimento
 * classificá-la. Não é "Outros": "Outros" é escolha do usuário, esta é a
 * ausência de escolha. Juntar as duas tornaria impossível listar o que ainda
 * falta classificar.
 */
export const CATEGORIA_NAO_CLASSIFICADO = "Não classificado";

/** Categorias criadas no seed e no primeiro uso de cada usuário. */
export const CATEGORIAS_PADRAO = [
  { nome: CATEGORIA_NAO_CLASSIFICADO, tipo: "ambos" as const },
  { nome: "Alimentação", tipo: "despesa" as const },
  { nome: "Combustível", tipo: "despesa" as const },
  { nome: "Transporte", tipo: "despesa" as const },
  { nome: "Moradia", tipo: "despesa" as const },
  { nome: "Saúde", tipo: "despesa" as const },
  { nome: "Lazer", tipo: "despesa" as const },
  { nome: "Assinaturas", tipo: "despesa" as const },
  { nome: "Viagens", tipo: "despesa" as const },
  { nome: "Educação", tipo: "despesa" as const },
  { nome: "Impostos", tipo: "despesa" as const },
  { nome: "Salário", tipo: "receita" as const },
  { nome: "Vendas", tipo: "receita" as const },
  { nome: "Serviços prestados", tipo: "receita" as const },
  { nome: "Outros", tipo: "ambos" as const },
];

export type CategoriaPadrao = (typeof CATEGORIAS_PADRAO)[number];
