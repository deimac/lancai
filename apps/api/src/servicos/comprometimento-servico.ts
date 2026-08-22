import {
  ModuloRelatorios,
  RepositorioRelatoriosDrizzle,
  detectar_padroes_recorrentes,
  listarMesesEntre,
  type CompraParcelada,
} from "@lancai/relatorios";
import {
  adicionarMeses,
  deISOParaData,
  normalizar_descricao_parcela,
  paraDataISO,
} from "@lancai/tipos";
import { listar_recorrencias, padrao_ja_conhecido } from "./recorrencia-servico";

const relatorios = new ModuloRelatorios(new RepositorioRelatoriosDrizzle());
const repositorio = new RepositorioRelatoriosDrizzle();
const MESES_GRAFICO = 12;

export type RecorrenteComprometimento = {
  id: string;
  descricao: string;
  valor: number;
  origem: "cadastro" | "detectado";
  diaDoMes: number | null;
  categoriaNome: string | null;
  icone: string;
  cor: string;
  contaNome: string | null;
  cartaoNome: string | null;
  tipo: string;
};

export type ComprometimentoMensal = {
  meses: Array<{ mes: string; parcelas: number; recorrentes: number }>;
  compras: CompraParcelada[];
  recorrentes: RecorrenteComprometimento[];
};

export async function montar_comprometimento(
  usuarioId: string,
  dataAtual: string,
): Promise<ComprometimentoMensal> {
  const visao = await relatorios.consultar_visao("parcelamentos", { usuarioId }, dataAtual);
  if (visao.tipo !== "parcelamentos") {
    throw new Error("Resposta inesperada do relatório de parcelamentos.");
  }

  const [movimentos, categorias, contas, cartoes, todasRecorrencias] = await Promise.all([
    repositorio.listarMovimentos(usuarioId, { tipos: ["despesa"] }),
    repositorio.listarCategorias(usuarioId),
    repositorio.listarContas(usuarioId),
    repositorio.listarCartoes(usuarioId),
    listar_recorrencias(usuarioId, { incluirInativas: true }),
  ]);

  const mapaCat = new Map(categorias.map((item) => [item.id, item]));
  const mapaConta = new Map(contas.map((item) => [item.id, item.nome]));
  const mapaCartao = new Map(cartoes.map((item) => [item.id, item.nome]));

  const cadastradas = todasRecorrencias.filter((item) => item.ativa);
  const detectados = detectar_padroes_recorrentes(movimentos, dataAtual).filter(
    (item) => !padrao_ja_conhecido(item, todasRecorrencias),
  );

  const recorrentes: RecorrenteComprometimento[] = [
    ...cadastradas.map((item) => {
      const cat = mapaCat.get(item.categoriaId);
      return {
        id: item.id,
        descricao: item.descricao,
        valor: Number(item.valor),
        origem: item.origem === "detectada" ? ("detectado" as const) : ("cadastro" as const),
        diaDoMes: item.diaDoMes,
        categoriaNome: cat?.nome ?? null,
        icone: cat?.icone ?? "geral",
        cor: cat?.cor ?? "neutro",
        contaNome: item.contaId ? (mapaConta.get(item.contaId) ?? null) : null,
        cartaoNome: item.cartaoId ? (mapaCartao.get(item.cartaoId) ?? null) : null,
        tipo: item.tipo,
      };
    }),
    ...detectados.map((item) => {
      const cat = item.categoriaId ? mapaCat.get(item.categoriaId) : undefined;
      return {
        id: `detectado:${normalizar_descricao_parcela(item.descricao)}:${item.valor}`,
        descricao: item.descricao,
        valor: item.valor,
        origem: "detectado" as const,
        diaDoMes: item.diaDoMes,
        categoriaNome: cat?.nome ?? null,
        icone: cat?.icone ?? "geral",
        cor: cat?.cor ?? "neutro",
        contaNome: item.contaId ? (mapaConta.get(item.contaId) ?? null) : null,
        cartaoNome: item.cartaoId ? (mapaCartao.get(item.cartaoId) ?? null) : null,
        tipo: "despesa",
      };
    }),
  ];

  const inicio = `${dataAtual.slice(0, 7)}-01`;
  const fim = paraDataISO(adicionarMeses(deISOParaData(inicio), MESES_GRAFICO - 1));
  const rotulosMes = listarMesesEntre(inicio, fim);
  const totalRecorrenteMes = recorrentes
    .filter((item) => item.tipo === "despesa")
    .reduce((soma, item) => soma + item.valor, 0);

  const meses = rotulosMes.map((mes) => {
    const parcelas = visao.dados.compras.reduce((soma, compra) => {
      const doMes = compra.parcelasPorMes.find((item) => item.mes === mes);
      return soma + (doMes?.valor ?? 0);
    }, 0);
    return { mes, parcelas, recorrentes: totalRecorrenteMes };
  });

  return {
    meses,
    compras: visao.dados.compras,
    recorrentes,
  };
}
