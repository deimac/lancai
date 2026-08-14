import { describe, expect, it } from "vitest";
import type { MovimentoResumo } from "../api";
import {
  classificacao_da_query,
  filtrar_extrato,
  origem_da_query,
  origem_para_query,
  paginar,
  tamanho_pagina_da_query,
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
    categoriaId: "cat-alimentacao",
    categoriaNome: "Alimentação",
    classificadoPor: "usuario",
    regraId: null,
    regraTrecho: null,
    classificadoEm: null,
    confiancaIa: null,
    perfil: "pf",
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
];

describe("filtrar_extrato", () => {
  it("corta pelo mês", () => {
    const ids = filtrar_extrato(lote, contas, cartoes, base).map((m) => m.id);
    expect(ids).toEqual(["1", "2", "3", "4"]);
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
    ).toEqual(["3", "4"]);
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
    expect(soItau).toEqual(["1", "4"]);

    const soAzul = filtrar_extrato(lote, contas, cartoes, {
      ...base,
      origem: { tipo: "cartao", id: "cartao-azul" },
    }).map((m) => m.id);
    expect(soAzul).toEqual(["3"]);
  });

  it("fila revisar pega sem categoria ou IA insegura", () => {
    const ids = filtrar_extrato(lote, contas, cartoes, { ...base, fila: "revisar" }).map((m) => m.id);
    expect(ids).toEqual(["4"]);
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
    expect(origem_da_query("lixo")).toEqual({ tipo: "todas" });
  });

  it("lê classificação e tamanho de página", () => {
    expect(classificacao_da_query("ia")).toBe("ia");
    expect(classificacao_da_query("x")).toBe("todas");
    expect(tamanho_pagina_da_query(null)).toBe(10);
    expect(tamanho_pagina_da_query("25")).toBe(25);
    expect(tamanho_pagina_da_query("7")).toBe(10);
  });
});
