import { and, eq, inArray } from "drizzle-orm";
import {
  cartao as cartaoTabela,
  obter_banco,
} from "@lancai/banco";
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
  type Perfil,
} from "@lancai/tipos";
import { obter_escopo_leitura } from "./escopo-workspace";
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
  /** Perfil da conta/cartão de destino — a tabela de recorrência não tem tipo_gasto. */
  tipoGasto: Perfil;
};

export type ComprometimentoMensal = {
  meses: Array<{ mes: string; parcelas: number; recorrentes: number }>;
  compras: CompraParcelada[];
  recorrentes: RecorrenteComprometimento[];
};

type CartaoDoEscopo = { id: string; perfil: string };

/**
 * Recorrentes/parcelados seguem o workspace ativo (não a visão Geral).
 * Cartão de outro espaço não entra; gasto PJ em cartão PF (e o inverso) também
 * não — senão o Pessoal herda hotel/agência no cartão pessoal.
 */
export function filtrar_compras_do_workspace(
  compras: CompraParcelada[],
  entrada: { visaoAgregada: boolean; cartoes: CartaoDoEscopo[] },
): CompraParcelada[] {
  if (entrada.visaoAgregada) return compras;
  const porId = new Map(entrada.cartoes.map((cartao) => [cartao.id, cartao]));
  return compras.filter((compra) => {
    if (!compra.cartaoId) return false;
    const cartao = porId.get(compra.cartaoId);
    if (!cartao) return false;
    if (compra.tipoGasto && compra.tipoGasto !== cartao.perfil) return false;
    return true;
  });
}

/** Mesma regra de `perfil_do_destino` na geração: cartão, senão conta, senão pf. */
export function perfil_do_destino_maps(
  cartaoId: string | null | undefined,
  contaId: string | null | undefined,
  cartoes: Map<string, string>,
  contas: Map<string, string>,
): Perfil {
  if (cartaoId) {
    const perfil = cartoes.get(cartaoId);
    if (perfil === "pj" || perfil === "pf") return perfil;
  }
  if (contaId) {
    const perfil = contas.get(contaId);
    if (perfil === "pj") return "pj";
  }
  return "pf";
}

export function recortar_por_tipo_gasto<T extends { tipoGasto?: string | null }>(
  itens: T[],
  perfil?: Perfil,
): T[] {
  if (!perfil) return itens;
  return itens.filter((item) => item.tipoGasto === perfil);
}

export async function montar_comprometimento(
  usuarioId: string,
  dataAtual: string,
  tipoGasto?: Perfil,
): Promise<ComprometimentoMensal> {
  const escopo = await obter_escopo_leitura(usuarioId);
  if (escopo.workspaceIds.length === 0) {
    return { meses: [], compras: [], recorrentes: [] };
  }

  const visao = await relatorios.consultar_visao("parcelamentos", { usuarioId }, dataAtual);
  if (visao.tipo !== "parcelamentos") {
    throw new Error("Resposta inesperada do relatório de parcelamentos.");
  }

  const [movimentos, categorias, contas, cartoes, todasRecorrencias, cartoesEscopo] = await Promise.all([
    repositorio.listarMovimentos(usuarioId, { tipos: ["despesa"] }),
    repositorio.listarCategorias(usuarioId),
    repositorio.listarContas(usuarioId),
    repositorio.listarCartoes(usuarioId),
    listar_recorrencias(usuarioId, { incluirInativas: true }),
    obter_banco()
      .select({ id: cartaoTabela.id, perfil: cartaoTabela.perfil })
      .from(cartaoTabela)
      .where(
        and(
          eq(cartaoTabela.usuarioId, usuarioId),
          inArray(cartaoTabela.workspaceId, escopo.workspaceIds),
          eq(cartaoTabela.ativo, true),
        ),
      ),
  ]);

  const compras = filtrar_compras_do_workspace(visao.dados.compras, {
    visaoAgregada: escopo.visaoAgregada,
    cartoes: cartoesEscopo,
  });

  const mapaCat = new Map(categorias.map((item) => [item.id, item]));
  const mapaConta = new Map(contas.map((item) => [item.id, item.nome]));
  const mapaCartao = new Map(cartoes.map((item) => [item.id, item.nome]));
  const mapaPerfilConta = new Map(contas.map((item) => [item.id, item.perfil]));
  const mapaPerfilCartao = new Map(cartoes.map((item) => [item.id, item.perfil]));
  for (const cartao of cartoesEscopo) {
    if (!mapaPerfilCartao.has(cartao.id)) mapaPerfilCartao.set(cartao.id, cartao.perfil);
  }

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
        tipoGasto: perfil_do_destino_maps(item.cartaoId, item.contaId, mapaPerfilCartao, mapaPerfilConta),
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
        tipoGasto: perfil_do_destino_maps(item.cartaoId, item.contaId, mapaPerfilCartao, mapaPerfilConta),
      };
    }),
  ];

  const comprasRecorte = recortar_por_tipo_gasto(compras, tipoGasto);
  const recorrentesRecorte = recortar_por_tipo_gasto(recorrentes, tipoGasto);

  const inicio = `${dataAtual.slice(0, 7)}-01`;
  const fim = paraDataISO(adicionarMeses(deISOParaData(inicio), MESES_GRAFICO - 1));
  const rotulosMes = listarMesesEntre(inicio, fim);
  const totalRecorrenteMes = recorrentesRecorte
    .filter((item) => item.tipo === "despesa")
    .reduce((soma, item) => soma + item.valor, 0);

  const meses = rotulosMes.map((mes) => {
    const parcelas = comprasRecorte.reduce((soma, compra) => {
      const doMes = compra.parcelasPorMes.find((item) => item.mes === mes);
      return soma + (doMes?.valor ?? 0);
    }, 0);
    return { mes, parcelas, recorrentes: totalRecorrenteMes };
  });

  return {
    meses,
    compras: comprasRecorte,
    recorrentes: recorrentesRecorte,
  };
}
