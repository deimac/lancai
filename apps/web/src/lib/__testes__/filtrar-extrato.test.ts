import { describe, expect, it } from "vitest";
import type { MovimentoResumo } from "../api";
import {
  classificacao_da_query,
  filtrar_extrato,
  origem_da_query,
  origem_para_query,
  paginar,
  tamanho_pagina_da_query,
  tipo_gasto_da_query,
  tipo_gasto_dashboard_da_query,
  tipo_gasto_dashboard_para_query,
  tipo_gasto_para_query,
  search_sem_tipo_gasto,
  papel_da_query,
  papel_para_query,
  perfil_de_tipo_gasto,
  quantidade_filtros_drawer,
  ordenar_categorias_por_uso,
  categorias_com_lancamentos,
  resumir_extrato,
  visao_da_query,
  visao_para_query,
  TAMANHO_PAGINA_PADRAO,
  type FiltrosExtrato,
} from "../filtrar-extrato";

function movimento(parcial: Partial<MovimentoResumo> & Pick<MovimentoResumo, "id">): MovimentoResumo {
  return {
    descricao: "Padaria",
    descricaoFonte: "PADARIA SAO JOSE",
    valor: "32.50",
    tipo: "despesa",
    status: "realizado",
    fonte: "open_finance",
    provedor: "pluggy",
    idExterno: null,
    dataMovimento: "2026-08-10",
    contaId: "conta-itau",
    cartaoId: null,
    statusFonte: "posted",
    parcelaNumero: null,
    parcelaTotal: null,
    ignoradoEmRelatorio: false,
    possivelRepetido: false,
    categoriaId: "cat-alimentacao",
    categoriaNome: "Alimentação",
    classificadoPor: "usuario",
    regraId: null,
    regraTrecho: null,
    classificadoEm: null,
    confiancaIa: null,
    tipoGasto: "pf",
    papel: "gasto",
    cartaoFaturaId: null,
    competenciaFatura: null,
    ...parcial,
  };
}

const contas = [
  { id: "conta-itau", nome: "Itaú" },
  { id: "conta-mp", nome: "Mercado Pago" },
];
const cartoes = [{ id: "cartao-azul", nome: "Azul Itaú" }];

const base: FiltrosExtrato = {
  mes: "2026-08",
  fila: "todas",
  busca: "",
  categoriaId: null,
  classificacao: "todas",
  origem: { tipo: "todas" },
  tipoGasto: "todas",
  papel: "todas",
};

const lote: MovimentoResumo[] = [
  movimento({ id: "1", descricao: "Padaria", contaId: "conta-itau" }),
  movimento({
    id: "2",
    descricao: "Uber",
    descricaoFonte: "UBER TRIP",
    contaId: "conta-mp",
    categoriaId: "cat-transporte",
    categoriaNome: "Transporte",
    classificadoPor: "regra",
  }),
  movimento({
    id: "3",
    descricao: "Farmácia",
    descricaoFonte: "FARMACIA DROGASIL",
    contaId: null,
    cartaoId: "cartao-azul",
    categoriaId: "cat-saude",
    categoriaNome: "Saúde",
    classificadoPor: "ia",
    confiancaIa: 0.9,
  }),
  movimento({
    id: "4",
    descricao: "Pix recebido",
    descricaoFonte: "PIX RECEBIDO",
    fonte: "manual",
    contaId: "conta-itau",
    categoriaId: "cat-nc",
    categoriaNome: "Não classificado",
    classificadoPor: "ia",
    confiancaIa: 0.4,
  }),
  movimento({
    id: "5",
    descricao: "Aluguel julho",
    dataMovimento: "2026-07-05",
    contaId: "conta-itau",
  }),
  movimento({
    id: "6",
    descricao: "iFood",
    descricaoFonte: "IFOOD",
    contaId: "conta-itau",
    categoriaId: "cat-alimentacao",
    categoriaNome: "Alimentação",
    classificadoPor: "ia",
    confiancaIa: 0.4,
  }),
];

describe("filtrar_extrato", () => {
  it("corta pelo mês", () => {
    const ids = filtrar_extrato(lote, contas, cartoes, base).map((m) => m.id);
    expect(ids).toEqual(["1", "2", "3", "4", "6"]);
  });

  it("não lista possível repetido que a pessoa não manteve", () => {
    const comRepetido = [
      ...lote,
      movimento({
        id: "rep",
        descricao: "PROTECH extra",
        possivelRepetido: true,
        ignoradoEmRelatorio: true,
      }),
    ];
    expect(filtrar_extrato(comRepetido, contas, cartoes, base).map((m) => m.id)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "6",
    ]);
  });

  it("não lista lançamento cancelado", () => {
    const comCancelado = [
      ...lote,
      movimento({ id: "x", descricao: "PREVER duplicado", status: "cancelado" }),
    ];
    expect(filtrar_extrato(comCancelado, contas, cartoes, base).map((m) => m.id)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "6",
    ]);
  });

  it("busca sem acento nem caixa em descrição, fonte e origem", () => {
    const porDescricao = filtrar_extrato(lote, contas, cartoes, { ...base, busca: "PADARIA" });
    expect(porDescricao.map((m) => m.id)).toEqual(["1"]);

    const porFonte = filtrar_extrato(lote, contas, cartoes, { ...base, busca: "sao jose" });
    expect(porFonte.map((m) => m.id)).toEqual(["1"]);

    const porConta = filtrar_extrato(lote, contas, cartoes, { ...base, busca: "mercado" });
    expect(porConta.map((m) => m.id)).toEqual(["2"]);

    const porCartao = filtrar_extrato(lote, contas, cartoes, { ...base, busca: "azul" });
    expect(porCartao.map((m) => m.id)).toEqual(["3"]);
  });

  it("filtra por categoria", () => {
    const ids = filtrar_extrato(lote, contas, cartoes, {
      ...base,
      categoriaId: "cat-transporte",
    }).map((m) => m.id);
    expect(ids).toEqual(["2"]);
  });

  it("filtra classificação Você, Regra, IA e sem classificar", () => {
    expect(
      filtrar_extrato(lote, contas, cartoes, { ...base, classificacao: "usuario" }).map((m) => m.id),
    ).toEqual(["1"]);
    expect(
      filtrar_extrato(lote, contas, cartoes, { ...base, classificacao: "regra" }).map((m) => m.id),
    ).toEqual(["2"]);
    expect(
      filtrar_extrato(lote, contas, cartoes, { ...base, classificacao: "ia" }).map((m) => m.id),
    ).toEqual(["3", "4", "6"]);
    expect(
      filtrar_extrato(lote, contas, cartoes, { ...base, classificacao: "sem_classificar" }).map(
        (m) => m.id,
      ),
    ).toEqual(["4"]);
  });

  it("isola conta ou cartão no workspace Geral", () => {
    const soItau = filtrar_extrato(lote, contas, cartoes, {
      ...base,
      origem: { tipo: "conta", id: "conta-itau" },
    }).map((m) => m.id);
    expect(soItau).toEqual(["1", "4", "6"]);

    const soAzul = filtrar_extrato(lote, contas, cartoes, {
      ...base,
      origem: { tipo: "cartao", id: "cartao-azul" },
    }).map((m) => m.id);
    expect(soAzul).toEqual(["3"]);
  });

  it("isola todas as contas ou todos os cartões", () => {
    expect(
      filtrar_extrato(lote, contas, cartoes, { ...base, origem: { tipo: "contas" } }).map((m) => m.id),
    ).toEqual(["1", "2", "4", "6"]);
    expect(
      filtrar_extrato(lote, contas, cartoes, { ...base, origem: { tipo: "cartoes" } }).map(
        (m) => m.id,
      ),
    ).toEqual(["3"]);
  });

  it("fila revisar pega só sem classificação, não IA com categoria", () => {
    const ids = filtrar_extrato(lote, contas, cartoes, { ...base, fila: "revisar" }).map((m) => m.id);
    expect(ids).toEqual(["4"]);
  });

  it("filtra tipo de gasto pessoal vs empresa", () => {
    const misto = [
      movimento({ id: "p", tipoGasto: "pf" }),
      movimento({ id: "e", tipoGasto: "pj", contaId: "conta-mp" }),
    ];
    expect(
      filtrar_extrato(misto, contas, cartoes, { ...base, tipoGasto: "pessoal" }).map((m) => m.id),
    ).toEqual(["p"]);
    expect(
      filtrar_extrato(misto, contas, cartoes, { ...base, tipoGasto: "empresa" }).map((m) => m.id),
    ).toEqual(["e"]);
  });

  it("filtra só gastos vs pagamentos de fatura", () => {
    const misto = [
      movimento({ id: "g", papel: "gasto" }),
      movimento({ id: "f", papel: "pagamento_fatura", descricao: "Fatura Itaú" }),
    ];
    expect(
      filtrar_extrato(misto, contas, cartoes, { ...base, papel: "gastos" }).map((m) => m.id),
    ).toEqual(["g"]);
    expect(
      filtrar_extrato(misto, contas, cartoes, { ...base, papel: "pagamentos_fatura" }).map(
        (m) => m.id,
      ),
    ).toEqual(["f"]);
  });

  it("visão Faturas recorta pelo ciclo; Movimentações pelo calendário", () => {
    const compraPosFecha = movimento({
      id: "agencias",
      cartaoId: "cartao-mp",
      contaId: null,
      dataMovimento: "2026-08-25",
    });
    const compraCicloFechado = movimento({
      id: "pizza",
      cartaoId: "cartao-itau",
      contaId: null,
      dataMovimento: "2026-08-18",
    });
    const compraCicloAberto = movimento({
      id: "hotel",
      cartaoId: "cartao-itau",
      contaId: null,
      dataMovimento: "2026-08-31",
    });
    const pixConta = movimento({
      id: "pix",
      contaId: "conta-itau",
      dataMovimento: "2026-08-10",
    });
    const loteCiclo = [compraPosFecha, compraCicloFechado, compraCicloAberto, pixConta];
    const cartoesCiclo = [
      { id: "cartao-mp", fechamento: 12 },
      { id: "cartao-itau", fechamento: 30 },
    ];

    expect(
      filtrar_extrato(loteCiclo, contas, cartoes, {
        ...base,
        visao: "movimentacoes",
      }).map((m) => m.id),
    ).toEqual(["agencias", "pizza", "hotel", "pix"]);

    expect(
      filtrar_extrato(loteCiclo, contas, cartoes, {
        ...base,
        visao: "faturas",
        cartoesCiclo,
        hoje: "2026-08-31",
      }).map((m) => m.id),
    ).toEqual(["agencias", "hotel"]);

    expect(
      filtrar_extrato(loteCiclo, contas, cartoes, {
        ...base,
        visao: "faturas",
        cartoesCiclo,
        hoje: "2026-10-15",
      }).map((m) => m.id),
    ).toEqual(["pizza"]);
  });
});

describe("paginar", () => {
  it("usa 10 como tamanho padrão da fatia", () => {
    const itens = Array.from({ length: 23 }, (_, i) => i + 1);
    const pagina1 = paginar(itens, 1, TAMANHO_PAGINA_PADRAO);
    expect(pagina1.itens).toHaveLength(10);
    expect(pagina1.de).toBe(1);
    expect(pagina1.ate).toBe(10);
    expect(pagina1.total).toBe(23);
    expect(pagina1.paginas).toBe(3);

    const pagina3 = paginar(itens, 3, TAMANHO_PAGINA_PADRAO);
    expect(pagina3.itens).toEqual([21, 22, 23]);
    expect(pagina3.de).toBe(21);
    expect(pagina3.ate).toBe(23);
  });

  it("recua para a última página válida (reset implícito)", () => {
    const itens = [1, 2, 3];
    const recuada = paginar(itens, 9, 10);
    expect(recuada.pagina).toBe(1);
    expect(recuada.itens).toEqual([1, 2, 3]);
  });
});

describe("parsers da URL", () => {
  it("lê origem conta/cartão", () => {
    expect(origem_da_query("conta:abc")).toEqual({ tipo: "conta", id: "abc" });
    expect(origem_da_query("cartao:azul")).toEqual({ tipo: "cartao", id: "azul" });
    expect(origem_para_query({ tipo: "conta", id: "abc" })).toBe("conta:abc");
    expect(origem_da_query("contas")).toEqual({ tipo: "contas" });
    expect(origem_da_query("cartoes")).toEqual({ tipo: "cartoes" });
    expect(origem_para_query({ tipo: "contas" })).toBe("contas");
    expect(origem_para_query({ tipo: "cartoes" })).toBe("cartoes");
    expect(origem_da_query("lixo")).toEqual({ tipo: "todas" });
  });

  it("lê classificação e tamanho de página", () => {
    expect(classificacao_da_query("ia")).toBe("ia");
    expect(classificacao_da_query("x")).toBe("todas");
    expect(tamanho_pagina_da_query(null)).toBe(10);
    expect(tamanho_pagina_da_query("25")).toBe(25);
    expect(tamanho_pagina_da_query("7")).toBe(10);
  });

  it("lê tipo de gasto pessoal/empresa", () => {
    expect(tipo_gasto_da_query("pessoal")).toBe("pessoal");
    expect(tipo_gasto_da_query("empresa")).toBe("empresa");
    expect(tipo_gasto_da_query("pf")).toBe("todas");
    expect(tipo_gasto_para_query("pessoal")).toBe("pessoal");
    expect(tipo_gasto_para_query("todas")).toBeNull();
    expect(tipo_gasto_dashboard_da_query(null)).toBe("todas");
    expect(tipo_gasto_dashboard_da_query("todos")).toBe("todas");
    expect(tipo_gasto_dashboard_da_query("empresa")).toBe("empresa");
    expect(tipo_gasto_dashboard_para_query("todas")).toBeNull();
    expect(perfil_de_tipo_gasto("pessoal")).toBe("pf");
    expect(perfil_de_tipo_gasto("todas")).toBeUndefined();
    expect(search_sem_tipo_gasto("?tipoGasto=pessoal&mes=2026-07")).toBe("?mes=2026-07");
    expect(search_sem_tipo_gasto("?tipoGasto=pessoal")).toBe("");
  });

  it("lê visão movimentações/faturas", () => {
    expect(visao_da_query("faturas")).toBe("faturas");
    expect(visao_da_query(null)).toBe("movimentacoes");
    expect(visao_da_query("x")).toBe("movimentacoes");
    expect(visao_para_query("faturas")).toBe("faturas");
    expect(visao_para_query("movimentacoes")).toBeNull();
  });

  it("lê papel gastos/pagamentos de fatura", () => {
    expect(papel_da_query("gastos")).toBe("gastos");
    expect(papel_da_query("pagamentos_fatura")).toBe("pagamentos_fatura");
    expect(papel_da_query("x")).toBe("todas");
    expect(papel_para_query("gastos")).toBe("gastos");
    expect(papel_para_query("todas")).toBeNull();
  });
});

describe("resumir_extrato", () => {
  it("soma entradas, saídas sem fatura e o que falta classificar", () => {
    const recorte = [
      movimento({ id: "e", tipo: "receita", valor: "100", papel: "gasto" }),
      movimento({ id: "s", tipo: "despesa", valor: "40", papel: "gasto" }),
      movimento({
        id: "f",
        tipo: "despesa",
        valor: "200",
        papel: "pagamento_fatura",
        descricao: "Fatura",
      }),
      movimento({
        id: "credito",
        tipo: "receita",
        valor: "9622.31",
        papel: "pagamento_fatura",
        descricao: "Pagamento recebido",
        cartaoId: "cartao-nu",
        contaId: null,
      }),
      movimento({
        id: "r",
        tipo: "despesa",
        valor: "15",
        categoriaNome: "Não classificado",
        categoriaId: "cat-nc",
      }),
      movimento({ id: "c", tipo: "despesa", valor: "99", status: "cancelado" }),
    ];
    expect(resumir_extrato(recorte)).toEqual({
      entradas: 100,
      saidas: 55,
      resultado: 45,
      revisarQuantidade: 1,
      revisarTotal: 15,
      proximaFatura: 0,
    });
  });

  it("crédito de quitação no cartão não infla entradas nem o resultado", () => {
    const recorte = [
      movimento({
        id: "pix",
        tipo: "receita",
        valor: "9622.31",
        papel: "pagamento_fatura",
        descricao: "Pagamento recebido",
        cartaoId: "cartao-nu",
        contaId: null,
      }),
      movimento({
        id: "estorno",
        tipo: "receita",
        valor: "21.13",
        papel: "gasto",
        descricao: "CURSOR",
        cartaoId: "cartao-azul",
        contaId: null,
      }),
    ];
    expect(resumir_extrato(recorte)).toEqual({
      entradas: 21.13,
      saidas: 0,
      resultado: 21.13,
      revisarQuantidade: 0,
      revisarTotal: 0,
      proximaFatura: 0,
    });
  });

  it("soma o recorte já filtrado, sem separar próxima fatura", () => {
    const recorte = [
      movimento({
        id: "agencias",
        tipo: "despesa",
        valor: "970.76",
        cartaoId: "cartao-mp",
        contaId: null,
        dataMovimento: "2026-08-25",
        status: "previsto",
      }),
      movimento({
        id: "pizza",
        tipo: "despesa",
        valor: "80",
        cartaoId: "cartao-itau",
        contaId: null,
        dataMovimento: "2026-08-18",
      }),
    ];
    expect(resumir_extrato(recorte)).toEqual({
      entradas: 0,
      saidas: 1050.76,
      resultado: -1050.76,
      revisarQuantidade: 0,
      revisarTotal: 0,
      proximaFatura: 0,
    });
  });
});

describe("ordenar_categorias_por_uso", () => {
  const alimentacao = { id: "cat-alimentacao", nome: "Alimentação" };
  const transporte = { id: "cat-transporte", nome: "Transporte" };
  const saude = { id: "cat-saude", nome: "Saúde" };

  it("lista as mais usadas primeiro e as nunca usadas no fim, A–Z no empate", () => {
    const movimentos = [
      movimento({ id: "a1", categoriaId: "cat-alimentacao" }),
      movimento({ id: "a2", categoriaId: "cat-alimentacao" }),
      movimento({ id: "a3", categoriaId: "cat-alimentacao" }),
      movimento({ id: "t1", categoriaId: "cat-transporte" }),
    ];
    expect(
      ordenar_categorias_por_uso([saude, transporte, alimentacao], movimentos).map((c) => c.nome),
    ).toEqual(["Alimentação", "Transporte", "Saúde"]);
  });

  it("não conta movimento cancelado", () => {
    const movimentos = [
      movimento({ id: "t1", categoriaId: "cat-transporte" }),
      movimento({ id: "t2", categoriaId: "cat-transporte", status: "cancelado" }),
      movimento({ id: "t3", categoriaId: "cat-transporte", status: "cancelado" }),
      movimento({ id: "a1", categoriaId: "cat-alimentacao" }),
      movimento({ id: "a2", categoriaId: "cat-alimentacao" }),
    ];
    expect(
      ordenar_categorias_por_uso([transporte, alimentacao, saude], movimentos).map((c) => c.nome),
    ).toEqual(["Alimentação", "Transporte", "Saúde"]);
  });
});

describe("categorias_com_lancamentos", () => {
  const alimentacao = { id: "cat-alimentacao", nome: "Alimentação" };
  const transporte = { id: "cat-transporte", nome: "Transporte" };
  const saude = { id: "cat-saude", nome: "Saúde" };

  it("omite categorias sem lançamento no recorte", () => {
    const movimentos = [
      movimento({ id: "a1", categoriaId: "cat-alimentacao" }),
      movimento({ id: "t1", categoriaId: "cat-transporte" }),
      movimento({ id: "s1", categoriaId: "cat-saude", status: "cancelado" }),
    ];
    expect(
      categorias_com_lancamentos([saude, transporte, alimentacao], movimentos).map((c) => c.nome),
    ).toEqual(["Alimentação", "Transporte"]);
  });
});

describe("quantidade_filtros_drawer", () => {
  it("conta só o que fica fora da barra", () => {
    expect(
      quantidade_filtros_drawer({
        categoriaId: null,
        classificacao: "todas",
        papel: "todas",
        fila: "todas",
      }),
    ).toBe(0);
    expect(
      quantidade_filtros_drawer({
        categoriaId: "cat-1",
        classificacao: "ia",
        papel: "gastos",
        fila: "revisar",
      }),
    ).toBe(4);
  });
});
