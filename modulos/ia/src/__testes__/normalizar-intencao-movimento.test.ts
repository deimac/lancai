import { describe, expect, it } from "vitest";
import { inferir_perfil_padrao } from "../inferir-perfil-padrao";
import { normalizar_intencao_movimento } from "../normalizar-intencao-movimento";
import type { ContextoInterpretacao } from "../prompt";

function contexto(parcial: Partial<ContextoInterpretacao> = {}): ContextoInterpretacao {
  return {
    dataAtual: "2026-08-02",
    contas: [],
    cartoes: [],
    categorias: [],
    pessoas: [],
    habitos: [],
    historicoRecente: [],
    intencaoPendente: null,
    ...parcial,
  };
}

describe("inferir_perfil_padrao", () => {
  it("retorna pf quando só há contas pessoais", () => {
    expect(inferir_perfil_padrao([{ perfil: "pf" }, { perfil: "pf" }])).toBe("pf");
  });

  it("retorna pj quando só há contas da empresa", () => {
    expect(inferir_perfil_padrao([{ perfil: "pj" }], [{ perfil: "pj" }])).toBe("pj");
  });

  it("retorna null quando há mistura pf e pj", () => {
    expect(inferir_perfil_padrao([{ perfil: "pf" }], [{ perfil: "pj" }])).toBeNull();
  });

  it("retorna null sem cadastros", () => {
    expect(inferir_perfil_padrao([])).toBeNull();
  });
});

describe("normalizar_intencao_movimento", () => {
  it("pede valor e conta quando a mensagem é vaga, mas assume perfil único pf", () => {
    const resultado = normalizar_intencao_movimento(
      {
        intencao: "REGISTRAR_MOVIMENTO",
        tipo_movimento: "despesa",
        descricao: "Mercado",
      },
      contexto({ contas: [{ nome: "C6 Bank", perfil: "pf" }, { nome: "Nubank", perfil: "pf" }] }),
    );

    expect(resultado.intencao).toBe("SOLICITAR_INFORMACAO");
    if (resultado.intencao !== "SOLICITAR_INFORMACAO") return;
    expect(resultado.pergunta).toContain("valor");
    expect(resultado.pergunta).toContain("conta");
    expect(resultado.pergunta).not.toContain("pessoal ou da empresa");
    expect(resultado.dados_parciais).toMatchObject({
      descricao: "Mercado",
      perfil: "pf",
      data_movimento: "2026-08-02",
    });
  });

  it("com mistura pf/pj pede só a conta — sem perguntar perfil", () => {
    const resultado = normalizar_intencao_movimento(
      {
        intencao: "REGISTRAR_MOVIMENTO",
        tipo_movimento: "despesa",
        descricao: "Mercado",
        valor: 120,
      },
      contexto({
        contas: [
          { nome: "C6 Bank", perfil: "pf" },
          { nome: "Mercado Pago", perfil: "pj" },
        ],
      }),
    );

    expect(resultado.intencao).toBe("SOLICITAR_INFORMACAO");
    if (resultado.intencao !== "SOLICITAR_INFORMACAO") return;
    expect(resultado.pergunta).toContain("conta");
    expect(resultado.pergunta).not.toContain("pessoal ou da empresa");
  });

  it("assume o perfil da conta/cartão citado mesmo com mistura pf/pj", () => {
    const naEmpresa = normalizar_intencao_movimento(
      {
        intencao: "REGISTRAR_MOVIMENTO",
        tipo_movimento: "despesa",
        descricao: "Software",
        valor: 200,
        conta_nome: "Mercado Pago",
      },
      contexto({
        contas: [
          { nome: "C6 Bank", perfil: "pf" },
          { nome: "Mercado Pago", perfil: "pj" },
        ],
      }),
    );
    expect(naEmpresa).toMatchObject({
      intencao: "REGISTRAR_MOVIMENTO",
      perfil: "pj",
      conta_nome: "Mercado Pago",
      forma_pagamento: "pix",
    });

    const noCartao = normalizar_intencao_movimento(
      {
        intencao: "REGISTRAR_MOVIMENTO",
        tipo_movimento: "despesa",
        descricao: "Almoço",
        valor: 40,
        cartao_nome: "Azul Itaú",
      },
      contexto({
        contas: [
          { nome: "C6 Bank", perfil: "pf" },
          { nome: "Mercado Pago", perfil: "pj" },
        ],
        cartoes: [{ nome: "Azul Itaú", perfil: "pf", modalidade: "credito", temConta: false }],
      }),
      "gastei 40 de almoço no Azul Itaú",
    );
    expect(noCartao).toMatchObject({
      intencao: "REGISTRAR_MOVIMENTO",
      perfil: "pf",
      cartao_nome: "Azul Itaú",
      forma_pagamento: "credito",
    });
  });

  it("completa lançamento quando só falta o que o contexto resolve", () => {
    const resultado = normalizar_intencao_movimento(
      {
        intencao: "REGISTRAR_MOVIMENTO",
        tipo_movimento: "despesa",
        descricao: "Mercado",
        valor: 85.5,
      },
      contexto({ contas: [{ nome: "C6 Bank", perfil: "pf" }] }),
    );

    expect(resultado).toMatchObject({
      intencao: "REGISTRAR_MOVIMENTO",
      tipo_movimento: "despesa",
      descricao: "Mercado",
      valor: 85.5,
      data_movimento: "2026-08-02",
      perfil: "pf",
      conta_nome: "C6 Bank",
    });
  });

  it("usa hábito de cartão principal quando disponível", () => {
    const resultado = normalizar_intencao_movimento(
      {
        intencao: "REGISTRAR_MOVIMENTO",
        tipo_movimento: "despesa",
        descricao: "Uber",
        valor: 32,
      },
      contexto({
        contas: [
          { nome: "C6 Bank", perfil: "pf" },
          { nome: "Nubank", perfil: "pf" },
        ],
        cartoes: [{ nome: "Nubank", perfil: "pf", modalidade: "credito", temConta: false }],
        habitos: [{ chave: "cartao_principal", valor: "Nubank" }],
      }),
    );

    expect(resultado.intencao).toBe("REGISTRAR_MOVIMENTO");
    if (resultado.intencao !== "REGISTRAR_MOVIMENTO") return;
    expect(resultado.cartao_nome).toBe("Nubank");
    expect(resultado.perfil).toBe("pf");
  });
});
