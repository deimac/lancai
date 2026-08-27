import type { EscopoFluxoConsulta } from "@lancai/ia";
import { formatarMoeda } from "@lancai/tipos";
import type { ItemHistorico, ResultadoVisao } from "@lancai/relatorios";

function rotuloPerfil(perfil: "pf" | "pj"): string {
  return perfil === "pj" ? "empresa" : "pessoal";
}

function formatarData(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split("-");
  return `${dia}/${mes}/${ano}`;
}

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

function isoOntem(hoje: string): string {
  const [ano, mes, dia] = hoje.split("-").map(Number);
  const dt = new Date(Date.UTC(ano ?? 0, (mes ?? 1) - 1, dia ?? 1));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

function dataFaladaUmDia(iso: string, dataAtual?: string): string {
  const [ano, mes, dia] = iso.split("-");
  const mesNome = MESES[Number(mes) - 1] ?? mes;
  const diaN = String(Number(dia));
  const anoAtual = dataAtual?.slice(0, 4);
  const comAno = anoAtual && ano !== anoAtual ? ` de ${ano}` : "";
  const nucleo = `${diaN} de ${mesNome}${comAno}`;
  if (dataAtual && iso === dataAtual) return `hoje, ${nucleo}`;
  if (dataAtual && iso === isoOntem(dataAtual)) return `ontem, ${nucleo}`;
  return nucleo;
}

function periodoFalado(periodo: { de: string; ate: string }, dataAtual?: string): string {
  if (periodo.de === periodo.ate) return dataFaladaUmDia(periodo.de, dataAtual);
  return `de ${dataFaladaUmDia(periodo.de, dataAtual)} a ${dataFaladaUmDia(periodo.ate, dataAtual)}`;
}

function quandoNaFrase(quando: string): string {
  if (quando.startsWith("hoje") || quando.startsWith("ontem") || quando.startsWith("de ")) return quando;
  return `em ${quando}`;
}

/** Sinal do valor no extrato: saída `-`, entrada `+`. */
function sinal_valor_historico(tipo: string): "+" | "-" {
  if (tipo === "despesa" || tipo === "retirada" || tipo === "emprestimo" || tipo === "transferencia") {
    return "-";
  }
  return "+";
}

function rotuloFormaPagamento(forma: string | null | undefined): string | null {
  if (!forma) return null;
  const mapa: Record<string, string> = {
    pix: "Pix",
    transferencia: "transferência",
    boleto: "boleto",
    dinheiro: "dinheiro",
    credito: "crédito",
    debito: "débito",
    ted: "TED",
    doc: "DOC",
  };
  return mapa[forma] ?? null;
}

function comVocativo(nome: string | undefined, usar: boolean, frase: string): string {
  if (!usar || !nome) return frase;
  const corpo = frase.charAt(0).toLocaleLowerCase("pt-BR") + frase.slice(1);
  return `${nome}, ${corpo}`;
}

export type ContraparteVazio = {
  entradas: number;
  saidas: number;
};

export type OpcoesRespostaVisao = {
  /** Histórico: false = só totais; true/omit = lista. Fluxo: true = lista; omit/false = só totais. */
  detalhado?: boolean;
  /** Lado da pergunta (gastei vs recebi); omitido = extrato completo. */
  escopoFluxo?: EscopoFluxoConsulta;
  /** Grain `top`: lista o maior/menor, nunca o total do período. */
  destaque?: "top";
  sentido?: "asc" | "desc";
  /** Grain `list` com limit: recorte, não soma do período. */
  listaLimitada?: boolean;
  ordenacaoLista?: { by: "valor" | "data" | "descricao"; dir: "asc" | "desc" };
  dataAtual?: string;
  primeiroNome?: string;
  /** Histórico filtrado vazio: o que houve no mesmo período sem o filtro de tipo. */
  contraparteVazio?: ContraparteVazio;
};

/**
 * Formata o resultado estruturado do `ModuloRelatorios` (Fase 5) no texto que
 * o usuário vê no chat. Mesma separação usada em `montar_resposta_chat`: o
 * módulo de domínio devolve dados, a camada de API formata a mensagem.
 */
export function montar_resposta_visao(
  resultado: ResultadoVisao,
  opcoes: OpcoesRespostaVisao = {},
): string {
  switch (resultado.tipo) {
    case "saldos": {
      const { contas, totalGeral } = resultado.dados;
      if (contas.length === 0) return "Você ainda não tem nenhuma conta cadastrada.";
      if (contas.length === 1) {
        const [conta] = contas;
        return `Você tem ${formatarMoeda(conta!.saldoAtual)} na conta "${conta!.nome}".`;
      }
      const linhas = contas.map((conta) => `- ${conta.nome} (${rotuloPerfil(conta.perfil)}): ${formatarMoeda(conta.saldoAtual)}`);
      return `${linhas.join("\n")}\n\nTotal: ${formatarMoeda(totalGeral)}`;
    }

    case "cartoes": {
      const { cartoes } = resultado.dados;
      if (cartoes.length === 0) return "Você ainda não tem nenhum cartão cadastrado.";
      const linhas = cartoes.map(
        (cartao) =>
          `- ${cartao.nome} (${rotuloPerfil(cartao.perfil)}): limite ${formatarMoeda(cartao.limite)}, comprometido ${formatarMoeda(
            cartao.comprometido,
          )}, disponível ${formatarMoeda(cartao.disponivel)} (fecha dia ${cartao.fechamento}, vence dia ${cartao.vencimento})`,
      );
      return linhas.join("\n");
    }

    case "parcelamentos": {
      const { compras } = resultado.dados;
      if (compras.length === 0) return "Você não tem nenhuma compra parcelada em aberto.";
      const linhas = compras.map((compra) => {
        const proxima = compra.proximaParcelaData ? ` (próxima em ${formatarData(compra.proximaParcelaData)})` : "";
        return `- "${compra.descricao}" no ${compra.cartaoNome}: faltam ${compra.parcelasRestantes}/${compra.parcelasTotais} parcelas, ${formatarMoeda(compra.valorRestante)} restantes${proxima}`;
      });
      return linhas.join("\n");
    }

    case "categoria": {
      const { categoriaNome, totalDespesas, totalReceitas, ranking } = resultado.dados;

      if (categoriaNome) {
        const partes = [`Em "${categoriaNome}", você gastou ${formatarMoeda(totalDespesas)}.`];
        if (totalReceitas > 0) partes.push(`Recebeu ${formatarMoeda(totalReceitas)} nessa categoria.`);
        return partes.join(" ");
      }

      if (ranking.length === 0) return "Não encontrei nenhuma despesa no período para montar um ranking de categorias.";
      const linhas = ranking.map((item, indice) => `${indice + 1}. ${item.categoriaNome}: ${formatarMoeda(item.total)}`);
      return `Suas categorias com mais gasto no período:\n${linhas.join("\n")}\n\nTotal de despesas: ${formatarMoeda(totalDespesas)}.`;
    }

    case "futuro": {
      const { periodo, totalComprometido, itens } = resultado.dados;
      if (itens.length === 0) return `Você não tem nenhum compromisso previsto até ${formatarData(periodo.ate)}.`;
      return `Você tem ${formatarMoeda(totalComprometido)} comprometidos até ${formatarData(periodo.ate)}, em ${itens.length} lançamento(s) futuro(s).`;
    }

    case "fluxo": {
      const { totalPessoalComEmpresa, totalEmpresaComPessoal, itens } = resultado.dados;
      if (itens.length === 0) return "Não encontrei nenhum gasto cruzado entre pessoa física e empresa no período.";

      const partes: string[] = [];
      if (totalPessoalComEmpresa > 0) {
        partes.push(`Você gastou ${formatarMoeda(totalPessoalComEmpresa)} de pessoal usando dinheiro da empresa.`);
      }
      if (totalEmpresaComPessoal > 0) {
        partes.push(`A empresa gastou ${formatarMoeda(totalEmpresaComPessoal)} usando seu dinheiro pessoal — a empresa te deve esse valor.`);
      }
      const resumo = partes.join(" ");
      if (opcoes.detalhado !== true) return resumo;

      const listar = (direcao: (typeof itens)[number]["direcao"]) =>
        itens
          .filter((item) => item.direcao === direcao)
          .sort((a, b) => a.data.localeCompare(b.data))
          .map((item) => `- ${formatarData(item.data)} · ${item.descricao} · ${formatarMoeda(item.valor)}`);

      const pessoal = listar("pessoal_com_empresa");
      const empresa = listar("empresa_com_pessoal");
      const plural = itens.length === 1 ? "" : "s";
      const cabecalho = `${resumo} (${itens.length} lançamento${plural}):`;
      if (pessoal.length > 0 && empresa.length > 0) {
        return `${cabecalho}\nPessoal com dinheiro da empresa:\n${pessoal.join("\n")}\nEmpresa com dinheiro pessoal:\n${empresa.join("\n")}`;
      }
      return `${cabecalho}\n${[...pessoal, ...empresa].join("\n")}`;
    }

    case "evolucao": {
      const { meses } = resultado.dados;
      const linhas = meses.map((mes) => `- ${mes.mes}: recebeu ${formatarMoeda(mes.receitas)}, gastou ${formatarMoeda(mes.despesas)} (saldo do mês: ${formatarMoeda(mes.saldoLiquido)})`);
      return linhas.join("\n");
    }

    case "historico": {
      const {
        periodo,
        filtroDescricao,
        totalReceitas,
        totalDespesas,
        saldoPeriodo,
        totalItens,
        itensOmitidos,
        deslocamento = 0,
        dias,
      } = resultado.dados;
      const escopo = opcoes.escopoFluxo ?? "ambos";
      const quando = quandoNaFrase(periodoFalado(periodo, opcoes.dataAtual));
      const umDia = periodo.de === periodo.ate;

      if (totalItens === 0) {
        return textoHistoricoVazio({
          quando,
          umDia,
          filtroDescricao,
          escopo,
          primeiroNome: opcoes.primeiroNome,
          contraparte: opcoes.contraparteVazio,
        });
      }

      const rotuloDescricao = filtroDescricao
        ? filtroDescricao.charAt(0).toLocaleUpperCase("pt-BR") + filtroDescricao.slice(1)
        : null;

      const destaqueTop = opcoes.destaque === "top";
      const listaLimitada = opcoes.listaLimitada === true;
      const detalhado = destaqueTop || listaLimitada || opcoes.detalhado !== false;
      const itensNaPagina = dias.reduce((total, dia) => total + dia.itens.length, 0);
      const plural = totalItens === 1 ? "" : "s";
      const vocativoResumo = !detalhado || destaqueTop;

      if (!detalhado) {
        return comVocativo(
          opcoes.primeiroNome,
          true,
          fraseResumoHistorico({
            escopo,
            rotuloDescricao,
            totalReceitas,
            totalDespesas,
            saldoPeriodo,
            totalItens,
            plural,
            quando,
          }),
        );
      }

      if (itensNaPagina === 0) {
        return "Não há mais lançamentos nessa lista. Peça um período ou filtro diferente se quiser outra busca.";
      }

      const itensFlat = dias.flatMap((dia) => dia.itens);
      if (destaqueTop && itensFlat.length === 1) {
        return comVocativo(
          opcoes.primeiroNome,
          true,
          fraseExtremo({
            item: itensFlat[0]!,
            periodoTexto: quando,
            escopo,
            rotuloDescricao: Boolean(rotuloDescricao),
            menor: opcoes.sentido === "asc",
          }),
        );
      }

      const ranquearPorValor =
        (destaqueTop && itensFlat.length > 1) || opcoes.ordenacaoLista?.by === "valor";
      let ordinal = 1;
      const secoes = ranquearPorValor
        ? itensComDataOrdenadosPorValor(dias, opcoes.sentido === "asc").map(({ item, data }) => {
            const n = ordinal;
            ordinal += 1;
            const quandoItem = dataFaladaUmDia(data, opcoes.dataAtual);
            return `${n}. ${linhaHistorico(item)} · ${quandoItem}`;
          })
        : dias.map((dia) => {
            const linhas = dia.itens.map((item) => {
              const n = ordinal;
              ordinal += 1;
              return `${n}. ${linhaHistorico(item)}`;
            });
            return `${dataFaladaUmDia(dia.data, opcoes.dataAtual)}\n${linhas.join("\n")}`;
          });

      const faixa =
        itensOmitidos > 0 || deslocamento > 0
          ? `mostrando ${deslocamento + 1}–${deslocamento + itensNaPagina} de ${totalItens}`
          : `${totalItens}`;

      let cabecalho: string[];
      if (destaqueTop) {
        cabecalho = [
          comVocativo(
            opcoes.primeiroNome,
            vocativoResumo,
            cabecalho_destaque_top({
              periodoTexto: quando,
              escopo,
              rotuloDescricao: Boolean(rotuloDescricao),
              itens: itensFlat,
              menor: opcoes.sentido === "asc",
            }),
          ),
        ];
      } else if (listaLimitada) {
        cabecalho = [
          cabecalho_lista_limitada({
            periodoTexto: quando,
            n: itensNaPagina,
            ordenacao: opcoes.ordenacaoLista,
          }),
        ];
      } else if (deslocamento > 0) {
        cabecalho = [`Próximos lançamentos ${quando} (${faixa}):`];
      } else {
        cabecalho = [
          fraseResumoHistorico({
            escopo,
            rotuloDescricao,
            totalReceitas,
            totalDespesas,
            saldoPeriodo,
            totalItens: faixa,
            plural: "",
            quando,
          }),
        ];
      }

      const rodape =
        !destaqueTop && !listaLimitada && itensOmitidos > 0
          ? [`… e mais ${itensOmitidos} lançamento(s). Diga "mais" para ver os próximos (ou peça um período menor).`]
          : [];

      return [...cabecalho, "", ...secoes, ...(rodape.length ? ["", ...rodape] : [])].join("\n");
    }
  }
}

function ladoDoResumo(
  escopo: EscopoFluxoConsulta,
  totalReceitas: number,
  totalDespesas: number,
): EscopoFluxoConsulta {
  if (totalReceitas > 0 && totalDespesas === 0) return "receita";
  if (totalDespesas > 0 && totalReceitas === 0) return "despesa";
  if (escopo === "despesa" || escopo === "receita") return escopo;
  return "ambos";
}

function fraseResumoHistorico(entrada: {
  escopo: EscopoFluxoConsulta;
  rotuloDescricao: string | null;
  totalReceitas: number;
  totalDespesas: number;
  saldoPeriodo: number;
  totalItens: number | string;
  plural: string;
  quando: string;
}): string {
  const contagem =
    typeof entrada.totalItens === "number"
      ? `em ${entrada.totalItens} lançamento${entrada.plural}`
      : `(${entrada.totalItens})`;
  const comDescricao = entrada.rotuloDescricao ? ` com "${entrada.rotuloDescricao}"` : "";
  const lado = ladoDoResumo(entrada.escopo, entrada.totalReceitas, entrada.totalDespesas);
  if (lado === "despesa") {
    return `Você teve ${formatarMoeda(entrada.totalDespesas)} de saídas${comDescricao} ${entrada.quando}, ${contagem}.`;
  }
  if (lado === "receita") {
    return `Você teve ${formatarMoeda(entrada.totalReceitas)} de entradas${comDescricao} ${entrada.quando}, ${contagem}.`;
  }
  return `Você teve ${formatarMoeda(entrada.totalReceitas)} de entradas e ${formatarMoeda(entrada.totalDespesas)} de saídas${comDescricao} ${entrada.quando}. Resultado ${formatarMoeda(entrada.saldoPeriodo)}, ${contagem}.`;
}

function textoHistoricoVazio(entrada: {
  quando: string;
  umDia: boolean;
  filtroDescricao?: string | null;
  escopo: EscopoFluxoConsulta;
  primeiroNome?: string;
  contraparte?: ContraparteVazio;
}): string {
  const vocativo = true;
  if (entrada.filtroDescricao) {
    return comVocativo(
      entrada.primeiroNome,
      vocativo,
      `Não encontrei lançamentos de "${entrada.filtroDescricao}" ${entrada.quando}.`,
    );
  }
  const pedido =
    entrada.escopo === "despesa" ? "saídas" : entrada.escopo === "receita" ? "entradas" : "lançamentos";
  const base = comVocativo(entrada.primeiroNome, vocativo, `Não houve ${pedido} ${entrada.quando}.`);
  const extra = fraseContraparte(entrada.contraparte, entrada.escopo, entrada.umDia);
  return extra ? `${base} ${extra}` : base;
}

function fraseContraparte(
  contraparte: ContraparteVazio | undefined,
  escopo: EscopoFluxoConsulta,
  umDia: boolean,
): string | null {
  if (!contraparte) return null;
  const { entradas, saidas } = contraparte;
  const onde = umDia ? "Nesse dia" : "Nesse período";
  if (escopo === "despesa" && entradas > 0 && saidas === 0) {
    const n = entradas === 1 ? "1 entrada" : `${entradas} entradas`;
    return `${onde} houve só ${n}.`;
  }
  if (escopo === "receita" && saidas > 0 && entradas === 0) {
    const n = saidas === 1 ? "1 saída" : `${saidas} saídas`;
    return `${onde} houve só ${n}.`;
  }
  if (entradas + saidas > 0) {
    const partes: string[] = [];
    if (entradas > 0) partes.push(entradas === 1 ? "1 entrada" : `${entradas} entradas`);
    if (saidas > 0) partes.push(saidas === 1 ? "1 saída" : `${saidas} saídas`);
    return `${onde} houve ${partes.join(" e ")}.`;
  }
  return null;
}

function itensComDataOrdenadosPorValor(
  dias: Array<{ data: string; itens: ItemHistorico[] }>,
  menor: boolean,
): Array<{ item: ItemHistorico; data: string }> {
  const dir = menor ? 1 : -1;
  return dias
    .flatMap((dia) => dia.itens.map((item) => ({ item, data: dia.data })))
    .sort((a, b) => {
      const delta = a.item.valor - b.item.valor;
      if (delta !== 0) return dir * delta;
      return b.data.localeCompare(a.data);
    });
}

function linhaHistorico(item: ItemHistorico): string {
  const origem = item.cartaoNome ? `cartão ${item.cartaoNome}` : item.contaNome ? item.contaNome : null;
  const valorComSinal = `${sinal_valor_historico(item.tipo)} ${formatarMoeda(item.valor)}`;
  const parcelaInfo =
    item.parcelaNumero != null && item.parcelaTotal != null && item.parcelaTotal >= 2
      ? [
          `Parcela ${item.parcelaNumero}/${item.parcelaTotal}`,
          ...(item.parcelaCompraValor != null ? [`total ${formatarMoeda(item.parcelaCompraValor)}`] : []),
        ]
      : [];
  const forma = rotuloFormaPagamento(item.formaPagamento);
  const partes = [
    item.descricao,
    valorComSinal,
    ...parcelaInfo,
    ...(item.hora ? [item.hora] : []),
    ...(forma ? [forma] : []),
    ...(origem ? [origem] : []),
  ];
  return partes.join(" · ");
}

function extrasItem(item: ItemHistorico): string {
  const forma = rotuloFormaPagamento(item.formaPagamento);
  const extra = [...(item.hora ? [`às ${item.hora}`] : []), ...(forma ? [forma] : [])];
  return extra.length ? ` ${extra.join(", ")}` : "";
}

function fraseExtremo(entrada: {
  item: ItemHistorico;
  periodoTexto: string;
  escopo: EscopoFluxoConsulta;
  rotuloDescricao: boolean;
  menor: boolean;
}): string {
  const extremo = entrada.menor ? "menor" : "maior";
  const valor = formatarMoeda(entrada.item.valor);
  const detalhe = `${entrada.item.descricao}${extrasItem(entrada.item)}`;
  if (entrada.escopo === "receita") {
    return `A ${extremo} entrada ${entrada.periodoTexto} foi ${valor}: ${detalhe}.`;
  }
  if (entrada.escopo === "despesa") {
    return `O ${extremo} gasto ${entrada.periodoTexto} foi ${valor}: ${detalhe}.`;
  }
  return `O ${extremo} lançamento ${entrada.periodoTexto} foi ${valor}: ${detalhe}.`;
}

function cabecalho_lista_limitada(entrada: {
  periodoTexto: string;
  n: number;
  ordenacao?: { by: "valor" | "data" | "descricao"; dir: "asc" | "desc" };
}): string {
  const porData = !entrada.ordenacao || entrada.ordenacao.by === "data";
  if (porData && entrada.ordenacao?.dir !== "asc") {
    return `Últimos ${entrada.n} lançamentos ${entrada.periodoTexto}:`;
  }
  if (porData && entrada.ordenacao?.dir === "asc") {
    return `Primeiros ${entrada.n} lançamentos ${entrada.periodoTexto}:`;
  }
  return `${entrada.n} lançamentos ${entrada.periodoTexto}:`;
}

function cabecalho_destaque_top(entrada: {
  periodoTexto: string;
  escopo: EscopoFluxoConsulta;
  rotuloDescricao: boolean;
  itens: Array<{ valor: number }>;
  menor: boolean;
}): string {
  const extremos = entrada.menor ? "menores" : "maiores";
  const n = entrada.itens.length;
  if (entrada.escopo === "receita") {
    return `As ${extremos} entradas ${entrada.periodoTexto} (${n}):`;
  }
  if (entrada.escopo === "despesa") {
    return `Os ${extremos} gastos ${entrada.periodoTexto} (${n}):`;
  }
  return `Os ${extremos} lançamentos ${entrada.periodoTexto} (${n}):`;
}
