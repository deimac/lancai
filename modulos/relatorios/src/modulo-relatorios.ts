import { eh_fluxo_cruzado } from "@lancai/financeiro";
import { paraNumero, schemaFiltrosVisaoResolvidos, somar } from "@lancai/tipos";
import type { FiltrosVisaoResolvidos, TipoVisao } from "@lancai/tipos";
import { fimDoAno, inicioFimMesAtual, listarMesesEntre, ultimosMeses } from "./datas-relatorio";
import type { RepositorioRelatorios } from "./repositorio-relatorios";
import type {
  CategoriaComTotal,
  CompraParcelada,
  ItemFluxo,
  ItemFuturo,
  MesEvolucao,
  ResultadoVisao,
} from "./tipos-resultado";

const QUANTIDADE_MESES_EVOLUCAO = 6;
const QUANTIDADE_ITENS_RANKING_CATEGORIA = 5;

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
        const parcelas = await this.repositorio.listarParcelas(filtros.usuarioId, { cartaoId: cartao.id });
        const comprometido = parcelas.length ? somar(...parcelas.map((parcela) => parcela.valor)) : 0;
        const limite = paraNumero(cartao.limite);
        return {
          nome: cartao.nome,
          perfil: cartao.perfil,
          limite,
          comprometido,
          disponivel: somar(limite, -comprometido),
          fechamento: cartao.fechamento,
          vencimento: cartao.vencimento,
        };
      }),
    );

    return { cartoes: linhas };
  }

  /**
   * O schema atual não tem um campo "parcela paga" — nenhuma tela marca uma
   * fatura como quitada. Convenção assumida aqui (ajustável se o produto
   * ganhar essa funcionalidade): parcelas com vencimento antes de `dataAtual`
   * já foram cobertas pela fatura correspondente ("pagas"); as demais contam
   * como "restantes".
   */
  private async consultar_parcelamentos(filtros: FiltrosVisaoResolvidos, dataAtual: string) {
    const parcelas = await this.repositorio.listarParcelas(filtros.usuarioId, { cartaoId: filtros.cartaoId });
    const cartoes = await this.repositorio.listarCartoes(filtros.usuarioId, filtros.perfil);
    const mapaCartoes = new Map(cartoes.map((cartao) => [cartao.id, cartao]));

    const porMovimento = new Map<string, typeof parcelas>();
    for (const parcela of parcelas) {
      if (!mapaCartoes.has(parcela.movimento.cartaoId ?? "")) continue; // cartão inativo ou fora do perfil filtrado
      const grupo = porMovimento.get(parcela.movimentoId) ?? [];
      grupo.push(parcela);
      porMovimento.set(parcela.movimentoId, grupo);
    }

    const compras: CompraParcelada[] = [];
    for (const grupoParcelas of porMovimento.values()) {
      const primeira = grupoParcelas[0];
      if (!primeira || grupoParcelas.length < 2) continue; // compra à vista não é "parcelamento"

      const cartao = mapaCartoes.get(primeira.movimento.cartaoId ?? "");
      const pagas = grupoParcelas.filter((parcela) => parcela.dataMovimento < dataAtual);
      const restantes = grupoParcelas.filter((parcela) => parcela.dataMovimento >= dataAtual);
      const proxima = restantes.sort((a, b) => a.dataMovimento.localeCompare(b.dataMovimento))[0];

      compras.push({
        descricao: primeira.movimento.descricao,
        cartaoNome: cartao?.nome ?? "cartão desconhecido",
        valorTotal: paraNumero(primeira.movimento.valor),
        parcelasTotais: grupoParcelas.length,
        parcelasPagas: pagas.length,
        parcelasRestantes: restantes.length,
        valorRestante: restantes.length ? somar(...restantes.map((parcela) => parcela.valor)) : 0,
        proximaParcelaData: proxima?.dataMovimento ?? null,
      });
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

    const totalPorCategoria = new Map<string, number>();
    for (const movimento of movimentosDespesa) {
      const atual = totalPorCategoria.get(movimento.categoriaId) ?? 0;
      totalPorCategoria.set(movimento.categoriaId, somar(atual, movimento.valor));
    }

    const ranking: CategoriaComTotal[] = [...totalPorCategoria.entries()]
      .map(([categoriaId, total]) => ({ categoriaNome: mapaCategorias.get(categoriaId) ?? "Sem categoria", total }))
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
    }));

    const movimentosPrevistos = movimentos.filter((movimento) => movimento.status === "previsto" && !movimento.cartaoId);
    const itensMovimento: ItemFuturo[] = movimentosPrevistos.map((movimento) => ({
      descricao: movimento.descricao,
      valor: paraNumero(movimento.valor),
      data: movimento.dataMovimento,
      origem: "movimento",
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
      this.repositorio.listarMovimentos(filtros.usuarioId, { perfil: filtros.perfil, periodo }),
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
      if (!perfilOrigem || !eh_fluxo_cruzado(movimento.perfil, perfilOrigem)) continue;

      itens.push({
        descricao: movimento.descricao,
        valor: paraNumero(movimento.valor),
        data: movimento.dataMovimento,
        direcao: movimento.perfil === "pf" ? "pessoal_com_empresa" : "empresa_com_pessoal",
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
}
