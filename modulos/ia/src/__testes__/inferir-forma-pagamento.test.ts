import { describe, expect, it } from "vitest";
import {
  inferir_forma_pagamento_da_mensagem,
  mensagem_pede_cartao_debito,
} from "../inferir-forma-pagamento";
import { normalizar_intencao_cadastro } from "../normalizar-intencao-cadastro";
import { normalizar_intencao_movimento } from "../normalizar-intencao-movimento";
import type { ContextoInterpretacao } from "../prompt";

function contexto(parcial: Partial<ContextoInterpretacao> = {}): ContextoInterpretacao {
  return {
    dataAtual: "2026-08-03",
    contas: [{ nome: "C6 Bank", perfil: "pf" }],
    cartoes: [{ nome: "Azul Itaú", perfil: "pf", modalidade: "credito", temConta: false }],
    categorias: [],
    pessoas: [],
    habitos: [],
    historicoRecente: [],
    intencaoPendente: null,
    ...parcial,
  };
}

describe("inferir_forma_pagamento_da_mensagem", () => {
  it("detecta pix, boleto, débito e crédito", () => {
    expect(inferir_forma_pagamento_da_mensagem("paguei no pix")).toBe("pix");
    expect(inferir_forma_pagamento_da_mensagem("paguei o boleto")).toBe("boleto");
    expect(inferir_forma_pagamento_da_mensagem("gastei no débito do Nubank")).toBe("debito");
    expect(inferir_forma_pagamento_da_mensagem("no crédito")).toBe("credito");
    expect(inferir_forma_pagamento_da_mensagem("gastei 50 no almoço")).toBeNull();
  });

  it("detecta cadastro de cartão de débito", () => {
    expect(mensagem_pede_cartao_debito("cadastra meu cartão de débito")).toBe(true);
    expect(mensagem_pede_cartao_debito("cadastra o cartão Nubank")).toBe(false);
  });
});

describe("normalizar forma e modalidade", () => {
  it("assume crédito no cartão sem pedir forma", () => {
    const resultado = normalizar_intencao_movimento(
      {
        intencao: "REGISTRAR_MOVIMENTO",
        tipo_movimento: "despesa",
        descricao: "Almoço",
        valor: 40,
        cartao_nome: "Azul Itaú",
      },
      contexto(),
      "gastei 40 de almoço no Azul Itaú",
    );

    expect(resultado).toMatchObject({
      intencao: "REGISTRAR_MOVIMENTO",
      forma_pagamento: "credito",
      perfil: "pf",
    });
  });

  it("infere pix na conta e não pergunta", () => {
    const resultado = normalizar_intencao_movimento(
      {
        intencao: "REGISTRAR_MOVIMENTO",
        tipo_movimento: "despesa",
        descricao: "Mercado",
        valor: 90,
        conta_nome: "C6 Bank",
      },
      contexto(),
      "paguei 90 de mercado no pix na C6",
    );

    expect(resultado).toMatchObject({
      intencao: "REGISTRAR_MOVIMENTO",
      forma_pagamento: "pix",
    });
  });

  it("conta sem pista de forma assume pix", () => {
    const resultado = normalizar_intencao_movimento(
      {
        intencao: "REGISTRAR_MOVIMENTO",
        tipo_movimento: "despesa",
        descricao: "Mercado",
        valor: 90,
        conta_nome: "C6 Bank",
      },
      contexto(),
      "gastei 90 de mercado na C6",
    );

    expect(resultado).toMatchObject({
      intencao: "REGISTRAR_MOVIMENTO",
      forma_pagamento: "pix",
    });
  });

  it("cadastro sem conta vira crédito; com conta vira múltiplo", () => {
    const soCredito = normalizar_intencao_cadastro(
      {
        intencao: "CRIAR_CARTAO",
        nome: "Nubank",
        limite: 5000,
        fechamento: 10,
        vencimento: 17,
      },
      contexto(),
      "cadastra o cartão Nubank limite 5000 fecha 10 vence 17",
    );
    expect(soCredito).toMatchObject({ intencao: "CRIAR_CARTAO", modalidade: "credito" });

    const multiplo = normalizar_intencao_cadastro(
      {
        intencao: "CRIAR_CARTAO",
        nome: "Nubank",
        limite: 5000,
        fechamento: 10,
        vencimento: 17,
        conta_nome: "C6 Bank",
      },
      contexto(),
      "cadastra o cartão Nubank vinculado à C6 Bank",
    );
    expect(multiplo).toMatchObject({ intencao: "CRIAR_CARTAO", modalidade: "multiplo" });
  });

  it("cartão de débito sem conta pede a conta", () => {
    const resultado = normalizar_intencao_cadastro(
      {
        intencao: "CRIAR_CARTAO",
        nome: "Visa",
      },
      contexto(),
      "cadastra meu cartão de débito Visa",
    );

    expect(resultado.intencao).toBe("SOLICITAR_INFORMACAO");
    if (resultado.intencao !== "SOLICITAR_INFORMACAO") return;
    expect(resultado.dados_parciais).toMatchObject({ modalidade: "debito", nome: "Visa" });
    expect(resultado.pergunta).toMatch(/conta vinculada/i);
  });
});
