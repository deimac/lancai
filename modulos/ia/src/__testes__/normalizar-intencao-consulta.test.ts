import { describe, expect, it } from "vitest";
import { cortar_cadastro_do_texto } from "../inferir-origem-movimento";
import { normalizar_intencao_consulta } from "../normalizar-intencao-consulta";
import type { ContextoInterpretacao } from "../prompt";

function contexto(parcial: Partial<ContextoInterpretacao> = {}): ContextoInterpretacao {
  return {
    dataAtual: "2026-08-23",
    contas: [],
    cartoes: [{ nome: "Revolut Visa", perfil: "pf", modalidade: "credito", temConta: false }],
    categorias: [
      { nome: "Transporte", tipo: "despesa" },
      { nome: "Tarifas", tipo: "despesa" },
    ],
    pessoas: [],
    habitos: [],
    historicoRecente: [],
    intencaoPendente: null,
    ...parcial,
  };
}

describe("cortar_cadastro_do_texto", () => {
  it("remove o cartão no final sem apagar 'do cartão de crédito' da descrição", () => {
    expect(
      cortar_cadastro_do_texto(
        "Tarifa ad. mensal do cartão de crédito do cartao revolut visa",
        "Revolut Visa",
      ),
    ).toBe("Tarifa ad. mensal do cartão de crédito");
  });
});

describe("normalizar_intencao_consulta", () => {
  it("não trata descrição de lançamento como categoria inexistente", () => {
    const mensagem =
      "me mostre todos os lancamentos de Tarifa ad. mensal do cartão de crédito do cartao revolut visa";
    const resultado = normalizar_intencao_consulta(
      {
        intencao: "CONSULTAR_VISAO",
        tipo_visao: "categoria",
        filtros: { categoria_nome: "Tarifa ad. mensal" },
      },
      contexto(),
      mensagem,
    );
    expect(resultado).toMatchObject({
      intencao: "CONSULTAR_VISAO",
      tipo_visao: "historico",
      detalhado: true,
      filtros: {
        descricao: "Tarifa ad. mensal",
        categoria_nome: null,
        cartao_nome: "Revolut Visa",
        periodo: { de: "2000-01-01", ate: "2026-08-23" },
      },
    });
  });

  it("mantém categoria real do contexto", () => {
    const resultado = normalizar_intencao_consulta(
      {
        intencao: "CONSULTAR_VISAO",
        tipo_visao: "categoria",
        filtros: { categoria_nome: "Transporte" },
      },
      contexto(),
      "quanto gastei com Transporte?",
    );
    expect(resultado).toMatchObject({
      tipo_visao: "categoria",
      filtros: { categoria_nome: "Transporte" },
    });
  });
});
