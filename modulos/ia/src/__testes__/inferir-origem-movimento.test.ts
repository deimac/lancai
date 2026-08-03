import { describe, expect, it } from "vitest";
import { inferir_origem_da_mensagem, resolver_nome_canonico } from "../inferir-origem-movimento";
import { normalizar_intencao_movimento } from "../normalizar-intencao-movimento";
import type { ContextoInterpretacao } from "../prompt";

function contexto(parcial: Partial<ContextoInterpretacao> = {}): ContextoInterpretacao {
  return {
    dataAtual: "2026-08-03",
    contas: [
      { nome: "C6 Bank", perfil: "pf" },
      { nome: "Mercado Pago", perfil: "pj" },
      { nome: "Nubank", perfil: "pf" },
    ],
    cartoes: [{ nome: "Azul Itaú", perfil: "pf", modalidade: "credito", temConta: false }],
    categorias: [],
    pessoas: [],
    habitos: [],
    historicoRecente: [],
    intencaoPendente: null,
    ...parcial,
  };
}

describe("inferir_origem_da_mensagem", () => {
  it("liga 'cartao azul' ao cartão Azul Itaú", () => {
    expect(
      inferir_origem_da_mensagem("gastei ontem 18,98 na farmacia com o cartao azul", contexto()),
    ).toEqual({ cartao_nome: "Azul Itaú" });
  });

  it("liga apelido C6 à conta C6 Bank", () => {
    expect(inferir_origem_da_mensagem("paguei 50 na C6", contexto())).toEqual({
      conta_nome: "C6 Bank",
    });
  });

  it("com a palavra cartão e um único cartão, usa esse cartão", () => {
    expect(
      inferir_origem_da_mensagem("gastei 20 no cartão", contexto()),
    ).toEqual({ cartao_nome: "Azul Itaú" });
  });
});

describe("resolver_nome_canonico", () => {
  it("expande azul para Azul Itaú", () => {
    expect(resolver_nome_canonico("azul", [{ nome: "Azul Itaú" }, { nome: "Inter" }])).toBe(
      "Azul Itaú",
    );
  });
});

describe("normalizar_intencao_movimento com origem na mensagem", () => {
  it("completa o lançamento da farmácia no cartão azul sem perguntar", () => {
    const resultado = normalizar_intencao_movimento(
      {
        intencao: "REGISTRAR_MOVIMENTO",
        tipo_movimento: "despesa",
        descricao: "farmacia",
        valor: 18.98,
      },
      contexto(),
      "gastei ontem 18,98 na farmacia com o cartao azul",
    );

    expect(resultado).toMatchObject({
      intencao: "REGISTRAR_MOVIMENTO",
      valor: 18.98,
      cartao_nome: "Azul Itaú",
      conta_nome: null,
      perfil: "pf",
      forma_pagamento: "credito",
      data_movimento: "2026-08-02",
    });
  });
});
