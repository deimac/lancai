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
});
