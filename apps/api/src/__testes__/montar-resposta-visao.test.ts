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
            valorParcela: 800,
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
    const dados = {
      periodo: { de: "2026-08-01", ate: "2026-08-31" },
      totalPessoalComEmpresa: 100,
      totalEmpresaComPessoal: 0,
      itens: [{ descricao: "Churrasco do Marcio", valor: 100, data: "2026-08-10", direcao: "pessoal_com_empresa" as const }],
    };
    const texto = montar_resposta_visao({ tipo: "fluxo", dados });
    expect(texto).toContain(`${formatarMoeda(100)} de pessoal usando dinheiro da empresa`);
    expect(texto).not.toContain("detalhado");
    expect(texto).not.toContain("Churrasco");
  });

  it("lista os lançamentos do fluxo quando detalhado", () => {
    const texto = montar_resposta_visao(
      {
        tipo: "fluxo",
        dados: {
          periodo: { de: "2026-08-01", ate: "2026-08-31" },
          totalPessoalComEmpresa: 100,
          totalEmpresaComPessoal: 0,
          itens: [{ descricao: "Churrasco do Marcio", valor: 100, data: "2026-08-10", direcao: "pessoal_com_empresa" }],
        },
      },
      { detalhado: true },
    );
    expect(texto).toContain("1 lançamento");
    expect(texto).toContain("10/08/2026 · Churrasco do Marcio ·");
    expect(texto).toContain(formatarMoeda(100));
  });

  it("separa os dois lados do fluxo no detalhe", () => {
    const texto = montar_resposta_visao(
      {
        tipo: "fluxo",
        dados: {
          periodo: { de: "2026-08-01", ate: "2026-08-31" },
          totalPessoalComEmpresa: 80,
          totalEmpresaComPessoal: 20,
          itens: [
            { descricao: "Churrasco", valor: 80, data: "2026-08-10", direcao: "pessoal_com_empresa" },
            { descricao: "Papelaria", valor: 20, data: "2026-08-12", direcao: "empresa_com_pessoal" },
          ],
        },
      },
      { detalhado: true },
    );
    expect(texto).toContain("Pessoal com dinheiro da empresa:");
    expect(texto).toContain("Churrasco");
    expect(texto).toContain("Empresa com dinheiro pessoal:");
    expect(texto).toContain("Papelaria");
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

    expect(texto).toMatch(/você teve/i);
    expect(texto).toContain("14 de agosto");
    expect(texto).toContain("15 de agosto");
    expect(texto).toContain(formatarMoeda(2500));
    expect(texto).toContain(`1. Almoço · - ${formatarMoeda(45)} · C6 Bank`);
    expect(texto).toContain(`2. Uber · - ${formatarMoeda(32)} · cartão Nubank`);
    expect(texto).not.toContain("despesa");
    expect(texto).not.toContain("pessoal");
    expect(texto).not.toContain("#aaaaaaaa");
    expect(texto).not.toContain("Cancela o");
    expect(texto).not.toContain("detalhado");
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

    expect(texto).toContain(`Você teve ${formatarMoeda(63.53)} de saídas com "Uber"`);
    expect(texto).not.toContain("detalhado");
    expect(texto).not.toContain("#aaaaaaaa");
    expect(texto).not.toContain("Cancela o");
  });

  it("resumo com nome de quem enviou usa o total de entradas, não saídas zeradas", () => {
    const texto = montar_resposta_visao(
      {
        tipo: "historico",
        dados: {
          periodo: { de: "2026-08-05", ate: "2026-08-20" },
          filtroDescricao: "Tayna Santos",
          totalReceitas: 450,
          totalDespesas: 0,
          saldoPeriodo: 450,
          totalItens: 3,
          itensOmitidos: 0,
          deslocamento: 0,
          dias: [],
        },
      },
      { detalhado: false, escopoFluxo: "receita" },
    );
    expect(texto).toContain(`Você teve ${formatarMoeda(450)} de entradas com "Tayna Santos"`);
    expect(texto).not.toMatch(/R\$ 0,00 de saídas/i);
  });

  it("resumo com só entradas usa o valor mesmo se o escopo vier errado como saída", () => {
    const texto = montar_resposta_visao(
      {
        tipo: "historico",
        dados: {
          periodo: { de: "2026-08-05", ate: "2026-08-20" },
          filtroDescricao: "Tayna Santos",
          totalReceitas: 450,
          totalDespesas: 0,
          saldoPeriodo: 450,
          totalItens: 3,
          itensOmitidos: 0,
          deslocamento: 0,
          dias: [],
        },
      },
      { detalhado: false, escopoFluxo: "despesa" },
    );
    expect(texto).toContain(`Você teve ${formatarMoeda(450)} de entradas com "Tayna Santos"`);
    expect(texto).not.toMatch(/R\$ 0,00 de saídas/i);
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

    expect(texto).toContain(`Você teve ${formatarMoeda(434.38)} de saídas`);
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

    expect(texto).toContain(`Você teve ${formatarMoeda(120)} de saídas`);
    expect(texto).not.toContain("receitas");
    expect(texto).not.toContain("detalhado");
  });

  it("escopo receita não menciona despesas no resumo", () => {
    const texto = montar_resposta_visao(
      {
        tipo: "historico",
        dados: {
          periodo: { de: "2026-08-01", ate: "2026-08-31" },
          totalReceitas: 78511.16,
          totalDespesas: 0,
          saldoPeriodo: 78511.16,
          totalItens: 16,
          itensOmitidos: 0,
          deslocamento: 0,
          dias: [],
        },
      },
      { detalhado: false, escopoFluxo: "receita" },
    );

    expect(texto).toContain(`Você teve ${formatarMoeda(78511.16)} de entradas`);
    expect(texto).not.toContain("despesas");
    expect(texto).not.toContain("saldo");
    expect(texto).not.toContain("detalhado");
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
    expect(texto).toBe("Não houve lançamentos de 1 de janeiro a 31 de janeiro.");
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
    expect(texto).not.toContain("Cancela o");
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

  it("destaque top lista a maior entrada em vez de somar o dia", () => {
    const texto = montar_resposta_visao(
      {
        tipo: "historico",
        dados: {
          periodo: { de: "2026-08-24", ate: "2026-08-24" },
          totalReceitas: 4734.05,
          totalDespesas: 0,
          saldoPeriodo: 4734.05,
          totalItens: 2,
          itensOmitidos: 1,
          deslocamento: 0,
          dias: [
            {
              data: "2026-08-24",
              itens: [
                {
                  id: "aaaaaaaa-1111-2222-3333-444455556666",
                  descricao: "PIX CLIENTE",
                  tipo: "receita",
                  valor: 7453,
                  perfil: "pj",
                  contaNome: "Mercado Pago",
                  cartaoNome: null,
                  categoriaNome: null,
                },
              ],
            },
          ],
        },
      },
      { detalhado: false, escopoFluxo: "receita", destaque: "top", sentido: "desc" },
    );

    expect(texto).toContain(`A maior entrada em 24 de agosto foi ${formatarMoeda(7453)}`);
    expect(texto).toContain("PIX CLIENTE");
    expect(texto).not.toMatch(/você teve/i);
    expect(texto).not.toContain(formatarMoeda(4734.05));
    expect(texto).not.toContain("2 lançamentos");
    expect(texto).not.toContain("#aaaaaaaa");
  });

  it("destaque top com vários dias lista por valor, não por data", () => {
    const texto = montar_resposta_visao(
      {
        tipo: "historico",
        dados: {
          periodo: { de: "2026-08-01", ate: "2026-08-31" },
          totalReceitas: 0,
          totalDespesas: 48310.3,
          saldoPeriodo: -48310.3,
          totalItens: 3,
          itensOmitidos: 0,
          deslocamento: 0,
          dias: [
            {
              data: "2026-08-23",
              itens: [
                {
                  id: "aaaaaaaa-1111-2222-3333-444455556666",
                  descricao: "ALVEA VIAGENS",
                  tipo: "despesa",
                  valor: 6754.58,
                  perfil: "pj",
                  contaNome: "Mercado Pago",
                  cartaoNome: null,
                  categoriaNome: null,
                },
              ],
            },
            {
              data: "2026-08-17",
              itens: [
                {
                  id: "bbbbbbbb-1111-2222-3333-444455556666",
                  descricao: "DENIS PEDRO GARCIA",
                  tipo: "despesa",
                  valor: 18596.72,
                  perfil: "pj",
                  contaNome: "Mercado Pago",
                  cartaoNome: null,
                  categoriaNome: null,
                },
              ],
            },
            {
              data: "2026-08-15",
              itens: [
                {
                  id: "cccccccc-1111-2222-3333-444455556666",
                  descricao: "AGENCIA DE TURISMO SAKURA LTDA",
                  tipo: "despesa",
                  valor: 22959,
                  perfil: "pj",
                  contaNome: "Mercado Pago",
                  cartaoNome: null,
                  categoriaNome: null,
                },
              ],
            },
          ],
        },
      },
      { detalhado: false, escopoFluxo: "despesa", destaque: "top", sentido: "desc" },
    );

    expect(texto).toMatch(/Os maiores gastos de 1 de agosto a 31 de agosto \(3\)/);
    const sakura = texto.indexOf("AGENCIA DE TURISMO SAKURA LTDA");
    const denis = texto.indexOf("DENIS PEDRO GARCIA");
    const alvea = texto.indexOf("ALVEA VIAGENS");
    expect(sakura).toBeGreaterThan(-1);
    expect(denis).toBeGreaterThan(sakura);
    expect(alvea).toBeGreaterThan(denis);
    expect(texto).toContain(`1. AGENCIA DE TURISMO SAKURA LTDA · - ${formatarMoeda(22959)}`);
    expect(texto).toContain("15 de agosto");
    expect(texto).not.toMatch(/^23 de agosto/m);
  });

  it("lista limitada não usa o cabeçalho de soma do período", () => {
    const texto = montar_resposta_visao(
      {
        tipo: "historico",
        dados: {
          periodo: { de: "2026-08-24", ate: "2026-08-24" },
          totalReceitas: 8000,
          totalDespesas: 120,
          saldoPeriodo: 7880,
          totalItens: 10,
          itensOmitidos: 7,
          deslocamento: 0,
          dias: [
            {
              data: "2026-08-24",
              itens: [
                {
                  id: "aaaaaaaa-1111-2222-3333-444455556666",
                  descricao: "Pix",
                  tipo: "receita",
                  valor: 500,
                  perfil: "pj",
                  contaNome: "Mercado Pago",
                  cartaoNome: null,
                  categoriaNome: null,
                },
                {
                  id: "bbbbbbbb-1111-2222-3333-444455556666",
                  descricao: "Almoço",
                  tipo: "despesa",
                  valor: 65,
                  perfil: "pj",
                  contaNome: "Mercado Pago",
                  cartaoNome: null,
                  categoriaNome: null,
                },
                {
                  id: "cccccccc-1111-2222-3333-444455556666",
                  descricao: "Uber",
                  tipo: "despesa",
                  valor: 32,
                  perfil: "pj",
                  contaNome: "Mercado Pago",
                  cartaoNome: null,
                  categoriaNome: null,
                },
              ],
            },
          ],
        },
      },
      {
        listaLimitada: true,
        ordenacaoLista: { by: "data", dir: "desc" },
        escopoFluxo: "ambos",
      },
    );

    expect(texto).toContain("Últimos 3 lançamentos em 24 de agosto:");
    expect(texto).toContain("1. Pix");
    expect(texto).not.toMatch(/você (teve|recebeu|gastou)/i);
    expect(texto).not.toContain(formatarMoeda(8000));
    expect(texto).not.toContain("#aaaaaaaa");
  });

  it("vocativo no resumo e no vazio, não na lista", () => {
    const dados = {
      periodo: { de: "2026-08-25", ate: "2026-08-25" },
      totalReceitas: 100,
      totalDespesas: 0,
      saldoPeriodo: 100,
      totalItens: 1,
      itensOmitidos: 0,
      deslocamento: 0,
      dias: [
        {
          data: "2026-08-25",
          itens: [
            {
              id: "aaaaaaaa-1111-2222-3333-444455556666",
              descricao: "Pix",
              tipo: "receita" as const,
              valor: 100,
              perfil: "pj" as const,
              contaNome: "Mercado Pago",
              cartaoNome: null,
              categoriaNome: null,
            },
          ],
        },
      ],
    };
    const resumo = montar_resposta_visao(
      { tipo: "historico", dados },
      { detalhado: false, escopoFluxo: "receita", primeiroNome: "Ana", dataAtual: "2026-08-25" },
    );
    expect(resumo).toMatch(/^Ana, você teve/);
    expect(resumo).toContain("hoje, 25 de agosto");
    expect(resumo).not.toContain("Pix");

    const lista = montar_resposta_visao(
      { tipo: "historico", dados },
      { detalhado: true, escopoFluxo: "receita", primeiroNome: "Ana", dataAtual: "2026-08-25" },
    );
    expect(lista).not.toMatch(/^Ana,/);
    expect(lista).toContain("1. Pix");

    const vazio = montar_resposta_visao(
      {
        tipo: "historico",
        dados: {
          ...dados,
          totalReceitas: 0,
          totalItens: 0,
          dias: [],
        },
      },
      {
        escopoFluxo: "despesa",
        primeiroNome: "Ana",
        dataAtual: "2026-08-25",
        contraparteVazio: { entradas: 3, saidas: 0 },
      },
    );
    expect(vazio).toMatch(/^Ana, não houve saídas hoje, 25 de agosto/);
    expect(vazio).toContain("Nesse dia houve só 3 entradas");
  });

  it("inclui hora e Pix na linha quando existem no item", () => {
    const texto = montar_resposta_visao(
      {
        tipo: "historico",
        dados: {
          periodo: { de: "2026-08-24", ate: "2026-08-24" },
          totalReceitas: 2548.12,
          totalDespesas: 0,
          saldoPeriodo: 2548.12,
          totalItens: 1,
          itensOmitidos: 0,
          deslocamento: 0,
          dias: [
            {
              data: "2026-08-24",
              itens: [
                {
                  id: "aaaaaaaa-1111-2222-3333-444455556666",
                  descricao: "CLAIR BOBATO LOPES",
                  tipo: "receita",
                  valor: 2548.12,
                  perfil: "pj",
                  contaNome: "Mercado Pago",
                  cartaoNome: null,
                  categoriaNome: null,
                  hora: "14:32",
                  formaPagamento: "pix",
                },
              ],
            },
          ],
        },
      },
      { escopoFluxo: "receita", dataAtual: "2026-08-25" },
    );
    expect(texto).toContain("1. CLAIR BOBATO LOPES · +");
    expect(texto).toContain("14:32");
    expect(texto).toContain("Pix");
    expect(texto).toContain("Mercado Pago");
    expect(texto).toContain("ontem, 24 de agosto");
  });
});
