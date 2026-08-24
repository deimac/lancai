import { eh_fluxo_cruzado } from "@lancai/financeiro";
import {
  LIMITE_ITENS_HISTORICO,
  agrupar_series_parcelamento,
  descricao_mais_completa,
  eh_movimento_parcelado,
  enxugar_indice_parcela,
  paraNumero,
  schemaFiltrosVisaoResolvidos,
  somar,
} from "@lancai/tipos";
import type { FiltrosVisaoResolvidos, TipoVisao } from "@lancai/tipos";
import { fimDoAno, inicioFimMesAtual, listarMesesEntre, ultimosMeses } from "./datas-relatorio";
import { total_compra_parcela } from "./metadados-parcela";
import type { RepositorioRelatorios } from "./repositorio-relatorios";
import type {
  CategoriaComTotal,
  CompraParcelada,
  DiaHistorico,
  ItemFluxo,
  ItemFuturo,
  ItemHistorico,
  MesEvolucao,
  ResultadoVisao,
} from "./tipos-resultado";

const QUANTIDADE_MESES_EVOLUCAO = 6;
const QUANTIDADE_ITENS_RANKING_CATEGORIA = 5;

/** Reexportado para consumidores do módulo de relatórios. */
export { LIMITE_ITENS_HISTORICO };

export type OpcoesConsultaVisao = {
  /** Histórico: quantos itens pular (paginação via “mais”). */
  deslocamento?: number;
};

/** Normaliza para filtro por descrição/estabelecimento (ex.: Uber ≈ uber). */
function normalizar_termo_descricao(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

function descricao_corresponde(cadastrada: string, termo: string): boolean {
  const alvo = normalizar_termo_descricao(cadastrada);
  const busca = normalizar_termo_descricao(termo);
  if (!alvo || !busca) return false;
  return alvo === busca || alvo.includes(busca) || busca.includes(alvo);
}

/** Conhecimento (`descricao`) ou Fato (`descricaoFonte`) — Pix some da descrição enxuta. */
function movimento_corresponde_descricao(
  movimento: { descricao: string; descricaoFonte?: string | null },
  termo: string,
): boolean {
  if (descricao_corresponde(movimento.descricao, termo)) return true;
  return Boolean(movimento.descricaoFonte && descricao_corresponde(movimento.descricaoFonte, termo));
}

/**
 * Responde `CONSULTAR_VISAO` — a Fase 5 do roadmap. Recebe filtros já
 * resolvidos (nomes -> IDs, feito pelo `ResolvedorIntencao`) e devolve dados
 * estruturados; quem formata o texto final para o usuário é a camada de API
 * (`apps/api/src/montar-resposta-visao.ts`), mesma separação usada pelo
 * `MotorFinanceiro` (devolve objetos, não strings).
 *
 * Nada aqui é gravado no banco — é só leitura e agregação em memória, no
 * mesmo estilo do `RepositorioFinanceiroDrizzle.obterTotalComprometidoCartao`.
 */
export class ModuloRelatorios {
  constructor(private readonly repositorio: RepositorioRelatorios) {}

  async consultar_visao(
    tipoVisao: TipoVisao,
    filtrosBrutos: FiltrosVisaoResolvidos,
    dataAtual: string,
    opcoes: OpcoesConsultaVisao = {},
  ): Promise<ResultadoVisao> {
    const filtros = schemaFiltrosVisaoResolvidos.parse(filtrosBrutos);

    switch (tipoVisao) {
      case "saldos":
        return { tipo: "saldos", dados: await this.consultar_saldos(filtros) };
      case "cartoes":
        return { tipo: "cartoes", dados: await this.consultar_cartoes(filtros) };
      case "parcelamentos":
        return { tipo: "parcelamentos", dados: await this.consultar_parcelamentos(filtros, dataAtual) };
      case "categoria":
        return { tipo: "categoria", dados: await this.consultar_categoria(filtros, dataAtual) };
      case "futuro":
        return { tipo: "futuro", dados: await this.consultar_futuro(filtros, dataAtual) };
      case "fluxo":
        return { tipo: "fluxo", dados: await this.consultar_fluxo(filtros, dataAtual) };
      case "evolucao":
        return { tipo: "evolucao", dados: await this.consultar_evolucao(filtros, dataAtual) };
      case "historico":
        return {
          tipo: "historico",
          dados: await this.consultar_historico(filtros, dataAtual, opcoes.deslocamento ?? 0),
        };
    }
  }

  private async consultar_saldos(filtros: FiltrosVisaoResolvidos) {
    const todasContas = await this.repositorio.listarContas(filtros.usuarioId, filtros.perfil);
    const contas = filtros.contaId ? todasContas.filter((conta) => conta.id === filtros.contaId) : todasContas;

    return {
      contas: contas.map((conta) => ({ nome: conta.nome, perfil: conta.perfil, saldoAtual: paraNumero(conta.saldoAtual) })),
      totalGeral: contas.length ? somar(...contas.map((conta) => conta.saldoAtual)) : 0,
    };
  }

  private async consultar_cartoes(filtros: FiltrosVisaoResolvidos) {
    const todosCartoes = await this.repositorio.listarCartoes(filtros.usuarioId, filtros.perfil);
    const cartoes = filtros.cartaoId ? todosCartoes.filter((cartao) => cartao.id === filtros.cartaoId) : todosCartoes;

    const linhas = await Promise.all(
      cartoes.map(async (cartao) => {
        const limite = paraNumero(cartao.limite);
        const saldoDevido = paraNumero(cartao.saldo);

        // Open Finance: `saldo` já é o limite usado (inclui parcelas futuras).
        // Somar parcelas de novo infla o comprometido e inventa disponível negativo.
        // Manual: não há saldo institucional confiável — usa parcelas em aberto.
        let comprometido: number;
        if (cartao.sincronizada) {
          comprometido = saldoDevido;
        } else {
          const parcelas = await this.repositorio.listarParcelas(filtros.usuarioId, {
            cartaoId: cartao.id,
          });
          const parcelasSoma = parcelas.length
            ? somar(...parcelas.map((parcela) => parcela.valor))
            : 0;
          comprometido = somar(saldoDevido, parcelasSoma);
        }

        return {
          id: cartao.id,
          nome: cartao.nome,
          perfil: cartao.perfil,
          limite,
          comprometido,
          disponivel: somar(limite, -comprometido),
          fechamento: cartao.fechamento,
          vencimento: cartao.vencimento,
          sincronizada: cartao.sincronizada,
        };
      }),
    );

    return { cartoes: linhas };
  }

  /**
   * Parcelas com vencimento antes de `dataAtual` já foram cobertas pela fatura
   * ("pagas"); as demais contam como restantes. Série OF = N movimentos;
   * lançamento manual = 1 movimento + linhas na tabela `parcela`.
   */
  private async consultar_parcelamentos(filtros: FiltrosVisaoResolvidos, dataAtual: string) {
    const [movimentos, parcelas, cartoes] = await Promise.all([
      this.repositorio.listarMovimentos(filtros.usuarioId, { cartaoId: filtros.cartaoId }),
      this.repositorio.listarParcelas(filtros.usuarioId, { cartaoId: filtros.cartaoId }),
      this.repositorio.listarCartoes(filtros.usuarioId, filtros.perfil),
    ]);
    const mapaCartoes = new Map(cartoes.map((cartao) => [cartao.id, cartao]));
    const idsSerieOf = new Set(
      movimentos.filter((movimento) => eh_movimento_parcelado(movimento)).map((movimento) => movimento.id),
    );

    const compras: CompraParcelada[] = [];

    for (const grupo of agrupar_series_parcelamento(
      movimentos.filter((movimento) => mapaCartoes.has(movimento.cartaoId ?? "")),
    )) {
      const primeira = grupo[0];
      if (!primeira) continue;
      const cartao = mapaCartoes.get(primeira.cartaoId ?? "");
      compras.push(
        montar_compra_de_itens({
          descricao: descricao_mais_completa(grupo.map((item) => item.descricao)),
          cartaoNome: cartao?.nome ?? "cartão desconhecido",
          valorTotal:
            total_compra_parcela({
              valorParcela: paraNumero(primeira.valor),
              parcelaTotal: primeira.parcelaTotal,
              parcelaCompraValor: primeira.parcelaCompraValor,
            }) ?? (grupo.length ? somar(...grupo.map((item) => item.valor)) : 0),
          parcelasTotais: primeira.parcelaTotal ?? grupo.length,
          itens: grupo.map((item) => ({
            data: String(item.dataMovimento).slice(0, 10),
            valor: item.valor,
            parcelaNumero: item.parcelaNumero ?? null,
          })),
          dataAtual,
        }),
      );
    }

    const porMovimento = new Map<string, typeof parcelas>();
    for (const parcela of parcelas) {
      if (idsSerieOf.has(parcela.movimentoId)) continue;
      if (!mapaCartoes.has(parcela.movimento.cartaoId ?? "")) continue;
      const grupo = porMovimento.get(parcela.movimentoId) ?? [];
      grupo.push(parcela);
      porMovimento.set(parcela.movimentoId, grupo);
    }

    for (const grupoParcelas of porMovimento.values()) {
      const primeira = grupoParcelas[0];
      if (!primeira || grupoParcelas.length < 2) continue;
      const cartao = mapaCartoes.get(primeira.movimento.cartaoId ?? "");
      compras.push(
        montar_compra_de_itens({
          descricao: enxugar_indice_parcela(primeira.movimento.descricao),
          cartaoNome: cartao?.nome ?? "cartão desconhecido",
          valorTotal: paraNumero(primeira.movimento.valor),
          parcelasTotais: grupoParcelas.length,
          itens: grupoParcelas.map((parcela) => ({
            data: parcela.dataMovimento,
            valor: parcela.valor,
            parcelaNumero: parcela.numeroParcela ?? null,
          })),
          dataAtual,
        }),
      );
    }

    return { compras: compras.sort((a, b) => b.valorRestante - a.valorRestante) };
  }

  private async consultar_categoria(filtros: FiltrosVisaoResolvidos, dataAtual: string) {
    const periodo = filtros.periodo ?? inicioFimMesAtual(dataAtual);

    if (filtros.categoriaId) {
      const categoria = await this.repositorio.obterCategoria(filtros.categoriaId);
      const movimentos = await this.repositorio.listarMovimentos(filtros.usuarioId, {
        perfil: filtros.perfil,
        categoriaId: filtros.categoriaId,
        periodo,
      });

      const despesas = movimentos.filter((movimento) => movimento.tipo === "despesa");
      const receitas = movimentos.filter((movimento) => movimento.tipo === "receita");

      return {
        categoriaNome: categoria?.nome ?? null,
        periodo,
        totalDespesas: despesas.length ? somar(...despesas.map((movimento) => movimento.valor)) : 0,
        totalReceitas: receitas.length ? somar(...receitas.map((movimento) => movimento.valor)) : 0,
        ranking: [],
      };
    }

    const [movimentosDespesa, movimentosReceita, categorias] = await Promise.all([
      this.repositorio.listarMovimentos(filtros.usuarioId, { perfil: filtros.perfil, periodo, tipos: ["despesa"] }),
      this.repositorio.listarMovimentos(filtros.usuarioId, { perfil: filtros.perfil, periodo, tipos: ["receita"] }),
      this.repositorio.listarCategorias(filtros.usuarioId),
    ]);
    const mapaCategorias = new Map(categorias.map((categoria) => [categoria.id, categoria.nome]));

    // Agrega por nome: o mesmo rótulo pode existir em mais de um workspace
    // ("Não classificado" de Pessoal + Empresa) e o ranking não deve repetir linha.
    const totalPorNome = new Map<string, number>();
    for (const movimento of movimentosDespesa) {
      const nome = mapaCategorias.get(movimento.categoriaId) ?? "Sem categoria";
      totalPorNome.set(nome, somar(totalPorNome.get(nome) ?? 0, movimento.valor));
    }

    const ranking: CategoriaComTotal[] = [...totalPorNome.entries()]
      .map(([categoriaNome, total]) => ({ categoriaNome, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, QUANTIDADE_ITENS_RANKING_CATEGORIA);

    return {
      categoriaNome: null,
      periodo,
      totalDespesas: movimentosDespesa.length ? somar(...movimentosDespesa.map((movimento) => movimento.valor)) : 0,
      totalReceitas: movimentosReceita.length ? somar(...movimentosReceita.map((movimento) => movimento.valor)) : 0,
      ranking,
    };
  }

  /**
   * "Comprometido até X": soma parcelas futuras de cartão (a imensa maioria dos
   * casos hoje) mais movimentos avulsos com `status: 'previsto'` — caminho que
   * o chat ainda não cria sozinho (REGISTRAR_MOVIMENTO sempre grava
   * 'realizado'), mas que já é suportado pelo schema/MotorFinanceiro.
   */
  private async consultar_futuro(filtros: FiltrosVisaoResolvidos, dataAtual: string) {
    const periodo = filtros.periodo ?? { de: dataAtual, ate: fimDoAno(dataAtual) };

    const [parcelas, movimentos] = await Promise.all([
      this.repositorio.listarParcelas(filtros.usuarioId, { cartaoId: filtros.cartaoId, periodo }),
      this.repositorio.listarMovimentos(filtros.usuarioId, { perfil: filtros.perfil, periodo }),
    ]);

    let parcelasFiltradas = parcelas;
    if (filtros.perfil) {
      const cartoes = await this.repositorio.listarCartoes(filtros.usuarioId, filtros.perfil);
      const idsCartoesDoPerfil = new Set(cartoes.map((cartao) => cartao.id));
      parcelasFiltradas = parcelas.filter((parcela) => idsCartoesDoPerfil.has(parcela.movimento.cartaoId ?? ""));
    }

    const itensParcela: ItemFuturo[] = parcelasFiltradas.map((parcela) => ({
      descricao: `${parcela.movimento.descricao} (parcela ${parcela.numeroParcela})`,
      valor: paraNumero(parcela.valor),
      data: parcela.dataMovimento,
      origem: "parcela",
      cartaoId: parcela.movimento.cartaoId,
    }));

    const movimentosPrevistos = movimentos.filter((movimento) => {
      if (movimento.status !== "previsto") return false;
      if (!movimento.cartaoId) return true;
      return eh_movimento_parcelado(movimento);
    });
    const itensMovimento: ItemFuturo[] = movimentosPrevistos.map((movimento) => ({
      descricao: eh_movimento_parcelado(movimento)
        ? `${movimento.descricao} (parcela ${movimento.parcelaNumero})`
        : movimento.descricao,
      valor: paraNumero(movimento.valor),
      data: String(movimento.dataMovimento).slice(0, 10),
      origem: eh_movimento_parcelado(movimento) ? "parcela" : "movimento",
      cartaoId: movimento.cartaoId,
    }));

    const itens = [...itensParcela, ...itensMovimento].sort((a, b) => a.data.localeCompare(b.data));

    return {
      periodo,
      totalComprometido: itens.length ? somar(...itens.map((item) => item.valor)) : 0,
      itens,
    };
  }

  /** Recalcula fluxo cruzado em tempo de consulta (docs, seção 4) — não depende do metadado gravado na auditoria. */
  private async consultar_fluxo(filtros: FiltrosVisaoResolvidos, dataAtual: string) {
    const periodo = filtros.periodo ?? inicioFimMesAtual(dataAtual);

    const [movimentos, contas, cartoes] = await Promise.all([
      this.repositorio.listarMovimentos(filtros.usuarioId, {
        perfil: filtros.perfil,
        periodo,
        tipos: filtros.tipos,
        contaId: filtros.contaId,
        cartaoId: filtros.cartaoId,
      }),
      this.repositorio.listarContas(filtros.usuarioId),
      this.repositorio.listarCartoes(filtros.usuarioId),
    ]);
    const mapaContas = new Map(contas.map((conta) => [conta.id, conta.perfil]));
    const mapaCartoes = new Map(cartoes.map((cartao) => [cartao.id, cartao.perfil]));

    const itens: ItemFluxo[] = [];
    for (const movimento of movimentos) {
      const perfilOrigem = movimento.contaId
        ? mapaContas.get(movimento.contaId)
        : movimento.cartaoId
          ? mapaCartoes.get(movimento.cartaoId)
          : undefined;
      if (!perfilOrigem || !eh_fluxo_cruzado(movimento.tipoGasto, perfilOrigem)) continue;

      const direcao = movimento.tipoGasto === "pf" ? "pessoal_com_empresa" : "empresa_com_pessoal";
      if (filtros.direcao && direcao !== filtros.direcao) continue;

      itens.push({
        descricao: movimento.descricao,
        valor: paraNumero(movimento.valor),
        data: movimento.dataMovimento,
        direcao,
      });
    }

    const totalPessoalComEmpresa = itens
      .filter((item) => item.direcao === "pessoal_com_empresa")
      .reduce((acumulado, item) => somar(acumulado, item.valor), 0);
    const totalEmpresaComPessoal = itens
      .filter((item) => item.direcao === "empresa_com_pessoal")
      .reduce((acumulado, item) => somar(acumulado, item.valor), 0);

    return { periodo, totalPessoalComEmpresa, totalEmpresaComPessoal, itens };
  }

  private async consultar_evolucao(filtros: FiltrosVisaoResolvidos, dataAtual: string) {
    const periodo = filtros.periodo ?? ultimosMeses(dataAtual, QUANTIDADE_MESES_EVOLUCAO);
    const movimentos = await this.repositorio.listarMovimentos(filtros.usuarioId, {
      perfil: filtros.perfil,
      periodo,
      tipos: ["receita", "despesa"],
    });

    const totaisPorMes = new Map<string, { receitas: number; despesas: number }>();
    for (const movimento of movimentos) {
      const mes = movimento.dataMovimento.slice(0, 7);
      const atual = totaisPorMes.get(mes) ?? { receitas: 0, despesas: 0 };
      if (movimento.tipo === "receita") atual.receitas = somar(atual.receitas, movimento.valor);
      else atual.despesas = somar(atual.despesas, movimento.valor);
      totaisPorMes.set(mes, atual);
    }

    const meses: MesEvolucao[] = listarMesesEntre(periodo.de, periodo.ate).map((mes) => {
      const totais = totaisPorMes.get(mes) ?? { receitas: 0, despesas: 0 };
      return { mes, receitas: totais.receitas, despesas: totais.despesas, saldoLiquido: somar(totais.receitas, -totais.despesas) };
    });

    return { periodo, meses };
  }

  /**
   * Extrato conversacional: lista lançamentos do período agrupados por dia,
   * com totais de receitas/despesas. Limitado a `LIMITE_ITENS_HISTORICO` itens
   * por página (os mais recentes primeiro); `deslocamento` avança a página.
   */
  private async consultar_historico(
    filtros: FiltrosVisaoResolvidos,
    dataAtual: string,
    deslocamentoBruto = 0,
  ) {
    const periodo = filtros.periodo ?? inicioFimMesAtual(dataAtual);
    const deslocamento = Math.max(0, Math.floor(deslocamentoBruto));

    const [movimentosBrutos, contas, cartoes, categorias] = await Promise.all([
      this.repositorio.listarMovimentos(filtros.usuarioId, {
        perfil: filtros.perfil,
        contaId: filtros.contaId,
        cartaoId: filtros.cartaoId,
        categoriaId: filtros.categoriaId,
        pessoaId: filtros.pessoaId,
        periodo,
        tipos: filtros.tipos,
      }),
      this.repositorio.listarContas(filtros.usuarioId),
      this.repositorio.listarCartoes(filtros.usuarioId),
      this.repositorio.listarCategorias(filtros.usuarioId),
    ]);

    const movimentos = filtros.descricao
      ? movimentosBrutos.filter((movimento) => movimento_corresponde_descricao(movimento, filtros.descricao!))
      : movimentosBrutos;

    const mapaContas = new Map(contas.map((conta) => [conta.id, conta.nome]));
    const mapaCartoes = new Map(cartoes.map((cartao) => [cartao.id, cartao.nome]));
    const mapaCategorias = new Map(categorias.map((categoria) => [categoria.id, categoria.nome]));

    const ordenados = [...movimentos].sort((a, b) => {
      const porData = b.dataMovimento.localeCompare(a.dataMovimento);
      if (porData !== 0) return porData;
      const instanteA = a.ocorridoEmInstante?.getTime() ?? 0;
      const instanteB = b.ocorridoEmInstante?.getTime() ?? 0;
      if (instanteA !== instanteB) return instanteB - instanteA;
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });

    const totalReceitas = ordenados
      .filter((movimento) => movimento.tipo === "receita")
      .reduce((acumulado, movimento) => somar(acumulado, movimento.valor), 0);
    const totalDespesas = ordenados
      .filter((movimento) => movimento.tipo === "despesa")
      .reduce((acumulado, movimento) => somar(acumulado, movimento.valor), 0);

    const totalItens = ordenados.length;
    const deslocamentoEfetivo = Math.min(deslocamento, totalItens);
    const exibidos = ordenados.slice(deslocamentoEfetivo, deslocamentoEfetivo + LIMITE_ITENS_HISTORICO);
    const itensOmitidos = Math.max(0, totalItens - deslocamentoEfetivo - exibidos.length);

    const porDia = new Map<string, ItemHistorico[]>();
    for (const movimento of exibidos) {
      const valor = paraNumero(movimento.valor);
      const parcelaNumero = movimento.parcelaNumero ?? null;
      const parcelaTotal = movimento.parcelaTotal ?? null;
      const parcelaCompraValor = total_compra_parcela({
        valorParcela: valor,
        parcelaTotal,
        parcelaCompraValor: movimento.parcelaCompraValor,
      });
      const item: ItemHistorico = {
        id: movimento.id,
        descricao: movimento.descricao,
        tipo: movimento.tipo,
        valor,
        perfil: movimento.tipoGasto,
        contaNome: movimento.contaId ? (mapaContas.get(movimento.contaId) ?? null) : null,
        cartaoNome: movimento.cartaoId ? (mapaCartoes.get(movimento.cartaoId) ?? null) : null,
        categoriaNome: mapaCategorias.get(movimento.categoriaId) ?? null,
        parcelaNumero,
        parcelaTotal,
        parcelaCompraValor,
      };
      const itensDoDia = porDia.get(movimento.dataMovimento) ?? [];
      itensDoDia.push(item);
      porDia.set(movimento.dataMovimento, itensDoDia);
    }

    const dias: DiaHistorico[] = [...porDia.entries()]
      .sort(([dataA], [dataB]) => dataB.localeCompare(dataA))
      .map(([data, itens]) => ({ data, itens }));

    return {
      periodo,
      filtroDescricao: filtros.descricao ?? null,
      totalReceitas,
      totalDespesas,
      saldoPeriodo: somar(totalReceitas, -totalDespesas),
      totalItens,
      itensOmitidos,
      deslocamento: deslocamentoEfetivo,
      dias,
    };
  }
}

function moda_valor(valores: number[]): number {
  const contagem = new Map<number, number>();
  for (const valor of valores) {
    const centavos = Math.round(valor * 100);
    contagem.set(centavos, (contagem.get(centavos) ?? 0) + 1);
  }
  let melhor = 0;
  let moda = valores[0] ?? 0;
  for (const [centavos, n] of contagem) {
    if (n > melhor) {
      melhor = n;
      moda = centavos / 100;
    }
  }
  return moda;
}

function montar_compra_de_itens(entrada: {
  descricao: string;
  cartaoNome: string;
  valorTotal: number;
  parcelasTotais: number;
  itens: Array<{ data: string; valor: string | number; parcelaNumero?: number | null }>;
  dataAtual: string;
}): CompraParcelada {
  const pagasPorData = entrada.itens.filter((item) => item.data < entrada.dataAtual);
  const restantes = entrada.itens
    .filter((item) => item.data >= entrada.dataAtual)
    .sort((a, b) => a.data.localeCompare(b.data));
  const numerosRestantes = restantes
    .map((item) => item.parcelaNumero)
    .filter((n): n is number => n != null && n >= 1);
  const menorRestante = numerosRestantes.length > 0 ? Math.min(...numerosRestantes) : null;
  const pagasPorNumero = menorRestante != null ? menorRestante - 1 : pagasPorData.length;
  const parcelasPagas = Math.min(entrada.parcelasTotais, Math.max(pagasPorData.length, pagasPorNumero));
  const porMes = new Map<string, number>();
  for (const item of entrada.itens) {
    const mes = item.data.slice(0, 7);
    porMes.set(mes, somar(porMes.get(mes) ?? 0, item.valor));
  }
  const valores = entrada.itens.map((item) => paraNumero(item.valor)).filter((valor) => valor > 0);
  const valorParcela = restantes[0]
    ? paraNumero(restantes[0].valor)
    : moda_valor(valores);
  return {
    descricao: entrada.descricao,
    cartaoNome: entrada.cartaoNome,
    valorTotal: entrada.valorTotal,
    valorParcela,
    parcelasTotais: entrada.parcelasTotais,
    parcelasPagas,
    parcelasRestantes: restantes.length,
    valorRestante: restantes.length ? somar(...restantes.map((item) => item.valor)) : 0,
    proximaParcelaData: restantes[0]?.data ?? null,
    parcelasPorMes: [...porMes.entries()]
      .map(([mes, valor]) => ({ mes, valor }))
      .sort((a, b) => a.mes.localeCompare(b.mes)),
  };
}
