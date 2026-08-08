import type { Perfil } from "@lancai/tipos";

export interface ResultadoSaldos {
  contas: Array<{ nome: string; perfil: Perfil; saldoAtual: number }>;
  totalGeral: number;
}

export interface ResultadoCartoes {
  cartoes: Array<{
    nome: string;
    perfil: Perfil;
    limite: number;
    comprometido: number;
    disponivel: number;
    fechamento: number;
    vencimento: number;
  }>;
}

export interface CompraParcelada {
  descricao: string;
  cartaoNome: string;
  valorTotal: number;
  parcelasTotais: number;
  parcelasPagas: number;
  parcelasRestantes: number;
  valorRestante: number;
  proximaParcelaData: string | null;
}

export interface ResultadoParcelamentos {
  compras: CompraParcelada[];
}

export interface CategoriaComTotal {
  categoriaNome: string;
  total: number;
}

export interface ResultadoCategoria {
  /** `null` quando o usuário não citou uma categoria específica — nesse caso `ranking` traz o top de gastos. */
  categoriaNome: string | null;
  periodo: { de: string; ate: string };
  totalDespesas: number;
  totalReceitas: number;
  ranking: CategoriaComTotal[];
}

export interface ItemFuturo {
  descricao: string;
  valor: number;
  data: string;
  origem: "parcela" | "movimento";
}

export interface ResultadoFuturo {
  periodo: { de: string; ate: string };
  totalComprometido: number;
  itens: ItemFuturo[];
}

export interface ItemFluxo {
  descricao: string;
  valor: number;
  data: string;
  direcao: "pessoal_com_empresa" | "empresa_com_pessoal";
}

export interface ResultadoFluxo {
  periodo: { de: string; ate: string };
  totalPessoalComEmpresa: number;
  totalEmpresaComPessoal: number;
  itens: ItemFluxo[];
}

export interface MesEvolucao {
  mes: string;
  receitas: number;
  despesas: number;
  saldoLiquido: number;
}

export interface ResultadoEvolucao {
  periodo: { de: string; ate: string };
  meses: MesEvolucao[];
}

export interface ItemHistorico {
  /** UUID do movimento — usado para montar o código curto no chat. */
  id: string;
  descricao: string;
  tipo: string;
  valor: number;
  perfil: Perfil;
  /** Nome da conta, ou `null` quando o lançamento foi no cartão. */
  contaNome: string | null;
  /** Prefixo amigável fica na formatação ("cartão X"); aqui só o nome. */
  cartaoNome: string | null;
  categoriaNome: string | null;
}

export interface DiaHistorico {
  data: string;
  itens: ItemHistorico[];
}

export interface ResultadoHistorico {
  periodo: { de: string; ate: string };
  /** Quando a consulta filtrou por estabelecimento/descrição (ex.: Uber). */
  filtroDescricao?: string | null;
  totalReceitas: number;
  totalDespesas: number;
  saldoPeriodo: number;
  /** Quantidade total de lançamentos no período (antes do limite de exibição). */
  totalItens: number;
  /** Quantos ficaram depois da página atual (ainda acessíveis com “mais”). */
  itensOmitidos: number;
  /** Quantos lançamentos foram pulados no início (paginação). */
  deslocamento: number;
  dias: DiaHistorico[];
}

export type ResultadoVisao =
  | { tipo: "saldos"; dados: ResultadoSaldos }
  | { tipo: "cartoes"; dados: ResultadoCartoes }
  | { tipo: "parcelamentos"; dados: ResultadoParcelamentos }
  | { tipo: "categoria"; dados: ResultadoCategoria }
  | { tipo: "futuro"; dados: ResultadoFuturo }
  | { tipo: "fluxo"; dados: ResultadoFluxo }
  | { tipo: "evolucao"; dados: ResultadoEvolucao }
  | { tipo: "historico"; dados: ResultadoHistorico };
