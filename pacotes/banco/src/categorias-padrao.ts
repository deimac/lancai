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

/** Categorias criadas no seed e no primeiro uso de cada usuário. */
export const CATEGORIAS_PADRAO = [
  { nome: CATEGORIA_NAO_CLASSIFICADO, tipo: "ambos" as const },
  { nome: CATEGORIA_PAGAMENTO_FATURA, tipo: "ambos" as const },
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
