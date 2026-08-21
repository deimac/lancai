import { formatarMoeda } from "@lancai/tipos";
import { describe, expect, it } from "vitest";
import { montar_resposta_visao } from "../montar-resposta-visao";

describe("montar_resposta_visao", () => {
  it("formata saldos de uma única conta de forma direta", () => {
    const texto = montar_resposta_visao({
      tipo: "saldos",
      dados: { contas: [{ nome: "Nubank", perfil: "pf", saldoAtual: 1000 }], totalGeral: 1000 },
    });
    expect(texto).toBe(`Você tem ${formatarMoeda(1000)} na conta "Nubank".`);
  });

  it("formata saldos de várias contas com total geral", () => {
    const texto = montar_resposta_visao({
      tipo: "saldos",
      dados: {
        contas: [
          { nome: "Nubank", perfil: "pf", saldoAtual: 1000 },
          { nome: "Inter PJ", perfil: "pj", saldoAtual: 16750.59 },
        ],
        totalGeral: 17750.59,
      },
    });
    expect(texto).toContain("Nubank (pessoal)");
    expect(texto).toContain("Inter PJ (empresa)");
    expect(texto).toContain(`Total: ${formatarMoeda(17750.59)}`);
  });

  it("avisa quando não há nenhuma conta cadastrada", () => {
    const texto = montar_resposta_visao({ tipo: "saldos", dados: { contas: [], totalGeral: 0 } });
    expect(texto).toBe("Você ainda não tem nenhuma conta cadastrada.");
  });

  it("formata cartões com limite, comprometido e disponível", () => {
    const texto = montar_resposta_visao({
      tipo: "cartoes",
      dados: {
        cartoes: [
          {
            id: "cartao-1",
            nome: "Inter Black",
            perfil: "pf",
            limite: 5000,
            comprometido: 1500,
            disponivel: 3500,
            fechamento: 20,
            vencimento: 27,
            sincronizada: false,
          },
        ],
      },
    });
    expect(texto).toContain("Inter Black");
    expect(texto).toContain(formatarMoeda(5000));
    expect(texto).toContain(formatarMoeda(3500));
  });

  it("avisa quando não há parcelamentos em aberto", () => {
    const texto = montar_resposta_visao({ tipo: "parcelamentos", dados: { compras: [] } });
    expect(texto).toBe("Você não tem nenhuma compra parcelada em aberto.");
  });

  it("formata parcelamentos em aberto com parcelas restantes", () => {
    const texto = montar_resposta_visao({
      tipo: "parcelamentos",
      dados: {
        compras: [
          {
            descricao: "Notebook",
            cartaoNome: "Inter Black",
            valorTotal: 8000,
            parcelasTotais: 10,
            parcelasPagas: 3,
            parcelasRestantes: 7,
            valorRestante: 5600,
            proximaParcelaData: "2026-08-27",
            parcelasPorMes: [{ mes: "2026-08", valor: 800 }],
          },
        ],
      },
    });
    expect(texto).toContain("Notebook");
    expect(texto).toContain("7/10");
    expect(texto).toContain(formatarMoeda(5600));
    expect(texto).toContain("27/08/2026");
  });

  it("formata gasto numa categoria específica", () => {
    const texto = montar_resposta_visao({
      tipo: "categoria",
      dados: { categoriaNome: "Alimentação", periodo: { de: "2026-08-01", ate: "2026-08-31" }, totalDespesas: 450, totalReceitas: 0, ranking: [] },
    });
    expect(texto).toBe(`Em "Alimentação", você gastou ${formatarMoeda(450)}.`);
  });

  it("formata ranking de categorias quando nenhuma é citada", () => {
    const texto = montar_resposta_visao({
      tipo: "categoria",
      dados: {
        categoriaNome: null,
        periodo: { de: "2026-08-01", ate: "2026-08-31" },
        totalDespesas: 400,
        totalReceitas: 0,
        ranking: [
          { categoriaNome: "Alimentação", total: 300 },
          { categoriaNome: "Combustível", total: 100 },
        ],
      },
    });
    expect(texto).toContain(`1. Alimentação: ${formatarMoeda(300)}`);
    expect(texto).toContain(`2. Combustível: ${formatarMoeda(100)}`);
  });

  it("formata compromissos futuros", () => {
    const texto = montar_resposta_visao({
      tipo: "futuro",
      dados: {
        periodo: { de: "2026-08-15", ate: "2026-12-31" },
        totalComprometido: 900,
        itens: [{ descricao: "Notebook (parcela 2)", valor: 300, data: "2026-09-27", origem: "parcela" }],
      },
    });
    expect(texto).toContain(formatarMoeda(900));
    expect(texto).toContain("31/12/2026");
  });

  it("formata fluxo cruzado pessoal pago com empresa", () => {
    const texto = montar_resposta_visao({
      tipo: "fluxo",
      dados: {
        periodo: { de: "2026-08-01", ate: "2026-08-31" },
        totalPessoalComEmpresa: 100,
        totalEmpresaComPessoal: 0,
        itens: [{ descricao: "Churrasco do Marcio", valor: 100, data: "2026-08-10", direcao: "pessoal_com_empresa" }],
      },
    });
    expect(texto).toContain(`${formatarMoeda(100)} de pessoal usando dinheiro da empresa`);
  });

  it("formata evolução mensal de receitas e despesas", () => {
    const texto = montar_resposta_visao({
      tipo: "evolucao",
      dados: {
        periodo: { de: "2026-07-01", ate: "2026-08-15" },
        meses: [{ mes: "2026-08", receitas: 1000, despesas: 200, saldoLiquido: 800 }],
      },
    });
    expect(texto).toContain("2026-08");
    expect(texto).toContain(formatarMoeda(1000));
    expect(texto).toContain(formatarMoeda(200));
  });

  it("formata histórico agrupado por dia com totais e dica de correção", () => {
    const texto = montar_resposta_visao({
      tipo: "historico",
      dados: {
        periodo: { de: "2026-08-14", ate: "2026-08-15" },
        totalReceitas: 2500,
        totalDespesas: 77,
        saldoPeriodo: 2423,
        totalItens: 3,
        itensOmitidos: 0,
        deslocamento: 0,
        dias: [
          {
            data: "2026-08-15",
            itens: [
              {
                id: "aaaaaaaa-1111-2222-3333-444455556666",
                descricao: "Almoço",
                tipo: "despesa",
                valor: 45,
                perfil: "pf",
                contaNome: "C6 Bank",
                cartaoNome: null,
                categoriaNome: "Alimentação",
              },
            ],
          },
          {
            data: "2026-08-14",
            itens: [
              {
                id: "bbbbbbbb-1111-2222-3333-444455556666",
                descricao: "Uber",
                tipo: "despesa",
                valor: 32,
                perfil: "pf",
                contaNome: null,
                cartaoNome: "Nubank",
                categoriaNome: "Transporte",
              },
            ],
          },
        ],
      },
    });

    expect(texto).toContain("Lançamentos de 14/08/2026 a 15/08/2026 (3):");
    expect(texto).toContain(`Receitas ${formatarMoeda(2500)}`);
    expect(texto).toContain("15/08/2026");
    expect(texto).toContain(`- #aaaaaaaa · Almoço · - ${formatarMoeda(45)} · C6 Bank`);
    expect(texto).toContain(`- #bbbbbbbb · Uber · - ${formatarMoeda(32)} · cartão Nubank`);
    expect(texto).not.toContain("despesa");
    expect(texto).not.toContain("pessoal");
    expect(texto).toContain("Cancela o #a1b2c3d4");
  });

  it("histórico em modo resumo mostra só totais", () => {
    const texto = montar_resposta_visao(
      {
        tipo: "historico",
        dados: {
          periodo: { de: "2026-08-01", ate: "2026-08-31" },
          filtroDescricao: "uber",
          totalReceitas: 0,
          totalDespesas: 63.53,
          saldoPeriodo: -63.53,
          totalItens: 2,
          itensOmitidos: 0,
          deslocamento: 0,
          dias: [
            {
              data: "2026-08-05",
              itens: [
                {
                  id: "aaaaaaaa-1111-2222-3333-444455556666",
                  descricao: "Uber",
                  tipo: "despesa",
                  valor: 38.58,
                  perfil: "pf",
                  contaNome: null,
                  cartaoNome: "Azul Itaú",
                  categoriaNome: "Transporte",
                },
              ],
            },
          ],
        },
      },
      { detalhado: false },
    );

    expect(texto).toContain(`Você gastou ${formatarMoeda(63.53)} com "Uber"`);
    expect(texto).toContain("detalhado");
    expect(texto).not.toContain("#aaaaaaaa");
    expect(texto).not.toContain("Cancela o");
  });

  it("histórico detalhado informa N/M e total da compra parcelada", () => {
    const texto = montar_resposta_visao(
      {
        tipo: "historico",
        dados: {
          periodo: { de: "2026-08-10", ate: "2026-08-10" },
          totalReceitas: 0,
          totalDespesas: 434.38,
          saldoPeriodo: -434.38,
          totalItens: 1,
          itensOmitidos: 0,
          deslocamento: 0,
          dias: [
            {
              data: "2026-08-10",
              itens: [
                {
                  id: "aaaaaaaa-1111-2222-3333-444455556666",
                  descricao: "E AGENCIAS*416333",
                  tipo: "despesa",
                  valor: 434.38,
                  perfil: "pf",
                  contaNome: null,
                  cartaoNome: "Mercado Pago",
                  categoriaNome: "Outros",
                  parcelaNumero: 1,
                  parcelaTotal: 10,
                  parcelaCompraValor: 4343.8,
                },
              ],
            },
          ],
        },
      },
      { escopoFluxo: "despesa" },
    );

    expect(texto).toContain(`Você gastou ${formatarMoeda(434.38)}`);
    expect(texto).toContain("1/10");
    expect(texto).toContain(`total ${formatarMoeda(4343.8)}`);
    expect(texto).toContain("cartão Mercado Pago");
    expect(texto).not.toContain(`Receitas ${formatarMoeda(0)}`);
  });

  it("escopo despesa não menciona receitas no resumo", () => {
    const texto = montar_resposta_visao(
      {
        tipo: "historico",
        dados: {
          periodo: { de: "2026-08-10", ate: "2026-08-10" },
          totalReceitas: 0,
          totalDespesas: 120,
          saldoPeriodo: -120,
          totalItens: 1,
          itensOmitidos: 0,
          deslocamento: 0,
          dias: [],
        },
      },
      { detalhado: false, escopoFluxo: "despesa" },
    );

    expect(texto).toContain(`Você gastou ${formatarMoeda(120)}`);
    expect(texto).not.toContain("receitas");
  });

  it("informa quando o histórico do período está vazio", () => {
    const texto = montar_resposta_visao({
      tipo: "historico",
      dados: {
        periodo: { de: "2026-01-01", ate: "2026-01-31" },
        totalReceitas: 0,
        totalDespesas: 0,
        saldoPeriodo: 0,
        totalItens: 0,
        itensOmitidos: 0,
        deslocamento: 0,
        dias: [],
      },
    });
    expect(texto).toBe("Não encontrei lançamentos nesse período.");
  });

  it("oferece paginação com mais quando há itens omitidos", () => {
    const texto = montar_resposta_visao({
      tipo: "historico",
      dados: {
        periodo: { de: "2026-08-01", ate: "2026-08-31" },
        totalReceitas: 0,
        totalDespesas: 400,
        saldoPeriodo: -400,
        totalItens: 45,
        itensOmitidos: 5,
        deslocamento: 0,
        dias: [
          {
            data: "2026-08-15",
            itens: [
              {
                id: "aaaaaaaa-1111-2222-3333-444455556666",
                descricao: "Almoço",
                tipo: "despesa",
                valor: 45,
                perfil: "pf",
                contaNome: "C6 Bank",
                cartaoNome: null,
                categoriaNome: "Alimentação",
              },
            ],
          },
        ],
      },
    });

    expect(texto).toContain("mostrando 1–1 de 45");
    expect(texto).toContain('Diga "mais" para ver os próximos');
    expect(texto).not.toContain("Peça um intervalo menor para ver todos");
  });

  it("marca continuação quando há deslocamento", () => {
    const texto = montar_resposta_visao({
      tipo: "historico",
      dados: {
        periodo: { de: "2026-08-01", ate: "2026-08-31" },
        totalReceitas: 0,
        totalDespesas: 400,
        saldoPeriodo: -400,
        totalItens: 45,
        itensOmitidos: 0,
        deslocamento: 40,
        dias: [
          {
            data: "2026-08-01",
            itens: [
              {
                id: "bbbbbbbb-1111-2222-3333-444455556666",
                descricao: "Café",
                tipo: "despesa",
                valor: 10,
                perfil: "pf",
                contaNome: "C6 Bank",
                cartaoNome: null,
                categoriaNome: "Alimentação",
              },
            ],
          },
        ],
      },
    });

    expect(texto).toContain("Próximos lançamentos");
    expect(texto).toContain("mostrando 41–41 de 45");
  });
});
