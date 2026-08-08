import { describe, expect, it } from "vitest";
import { interpretar_lancamento_rapido } from "../interpretar-lancamento-rapido";
import type { ContextoInterpretacao } from "../prompt";

function contexto(parcial: Partial<ContextoInterpretacao> = {}): ContextoInterpretacao {
  return {
    dataAtual: "2026-08-03",
    contas: [
      { nome: "C6 Bank", perfil: "pf" },
      { nome: "Mercado Pago", perfil: "pj" },
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

describe("interpretar_lancamento_rapido", () => {
  it("registra farmácia no cartão azul sem IA", () => {
    const resultado = interpretar_lancamento_rapido(
      "gastei ontem 18,98 na farmacia no cartao azul",
      contexto(),
    );

    expect(resultado).toMatchObject({
      intencao: "REGISTRAR_MOVIMENTO",
      tipo_movimento: "despesa",
      valor: 18.98,
      cartao_nome: "Azul Itaú",
      perfil: "pf",
      forma_pagamento: "credito",
      data_movimento: "2026-08-02",
    });
    if (resultado?.intencao === "REGISTRAR_MOVIMENTO") {
      expect(resultado.descricao.toLowerCase()).toContain("farmac");
    }
  });

  it("registra despesa na conta por apelido", () => {
    const resultado = interpretar_lancamento_rapido("paguei 50 de uber na C6", contexto());
    expect(resultado).toMatchObject({
      intencao: "REGISTRAR_MOVIMENTO",
      valor: 50,
      conta_nome: "C6 Bank",
      forma_pagamento: "pix",
      perfil: "pf",
    });
  });

  it("não intercepta consultas nem correções", () => {
    expect(interpretar_lancamento_rapido("quanto tenho no total?", contexto())).toBeNull();
    expect(interpretar_lancamento_rapido("corrige o almoço para 20", contexto())).toBeNull();
    expect(interpretar_lancamento_rapido("cadastra meu cartão Nubank", contexto())).toBeNull();
  });

  it("não intercepta quando falta valor ou origem", () => {
    expect(interpretar_lancamento_rapido("gastei na farmacia no cartao azul", contexto())).toBeNull();
    expect(interpretar_lancamento_rapido("gastei 18,98 na farmacia", contexto())).toBeNull();
  });

  it("não mistura data explícita na descrição", () => {
    const resultado = interpretar_lancamento_rapido(
      "gastei 18,98 na farmacia no cartao azul no dia 02/08/2026",
      contexto(),
    );
    expect(resultado).toMatchObject({
      intencao: "REGISTRAR_MOVIMENTO",
      data_movimento: "2026-08-02",
    });
    if (resultado?.intencao === "REGISTRAR_MOVIMENTO") {
      expect(resultado.descricao.toLowerCase()).toBe("farmacia");
    }
  });

  it("aceita 'reais' e 'dia N' sem chamar a IA", () => {
    const resultado = interpretar_lancamento_rapido(
      "gastei 20,00 reais com 99 dia 02 no cartao azul",
      contexto(),
    );
    expect(resultado).toMatchObject({
      intencao: "REGISTRAR_MOVIMENTO",
      tipo_movimento: "despesa",
      valor: 20,
      cartao_nome: "Azul Itaú",
      data_movimento: "2026-08-02",
      descricao: "99",
    });
  });

  it("aceita valor inteiro seguido de reais", () => {
    const resultado = interpretar_lancamento_rapido(
      "gastei 45 reais de uber na C6",
      contexto(),
    );
    expect(resultado).toMatchObject({
      intencao: "REGISTRAR_MOVIMENTO",
      valor: 45,
      conta_nome: "C6 Bank",
    });
    if (resultado?.intencao === "REGISTRAR_MOVIMENTO") {
      expect(resultado.descricao.toLowerCase()).toContain("uber");
    }
  });

  it("completa slot com valor solto sem chamar a IA", () => {
    const resultado = interpretar_lancamento_rapido(
      "50",
      contexto({
        intencaoPendente: {
          intencao_pendente: "REGISTRAR_MOVIMENTO",
          dados_parciais: {
            tipo_movimento: "despesa",
            descricao: "Farmácia",
            cartao_nome: "Azul Itaú",
            perfil: "pf",
          },
        },
      }),
    );

    expect(resultado).toMatchObject({
      intencao: "REGISTRAR_MOVIMENTO",
      descricao: "Farmácia",
      valor: 50,
      cartao_nome: "Azul Itaú",
    });
  });

  it("completa slot com conta citada", () => {
    const resultado = interpretar_lancamento_rapido(
      "na C6",
      contexto({
        intencaoPendente: {
          intencao_pendente: "REGISTRAR_MOVIMENTO",
          dados_parciais: {
            tipo_movimento: "despesa",
            descricao: "Uber",
            valor: 35,
          },
        },
      }),
    );

    expect(resultado).toMatchObject({
      intencao: "REGISTRAR_MOVIMENTO",
      descricao: "Uber",
      valor: 35,
      conta_nome: "C6 Bank",
    });
  });

  it("enxuga vocativo, Pix e valor na descrição do atalho", () => {
    const resultado = interpretar_lancamento_rapido(
      "Lançai gastei 304,00 no tênis Adidas no pix na Mercado Pago",
      contexto(),
    );
    expect(resultado).toMatchObject({
      intencao: "REGISTRAR_MOVIMENTO",
      valor: 304,
      conta_nome: "Mercado Pago",
      forma_pagamento: "pix",
      descricao: "Tênis Adidas",
    });
  });
});
