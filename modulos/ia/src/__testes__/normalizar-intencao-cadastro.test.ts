import { describe, expect, it } from "vitest";
import { normalizar_intencao_cadastro } from "../normalizar-intencao-cadastro";
import type { ContextoInterpretacao } from "../prompt";

function contexto(parcial: Partial<ContextoInterpretacao> = {}): ContextoInterpretacao {
  return {
    dataAtual: "2026-08-02",
    contas: [{ nome: "C6 Bank", perfil: "pf" }],
    cartoes: [],
    categorias: [],
    pessoas: [],
    habitos: [],
    historicoRecente: [],
    ...parcial,
  };
}

describe("normalizar_intencao_cadastro", () => {
  it("mescla limite da intenção pendente ao completar fechamento/vencimento", () => {
    const resultado = normalizar_intencao_cadastro(
      {
        intencao: "CRIAR_CARTAO",
        nome: "Azul Itaú",
        fechamento: 30,
        vencimento: 6,
        perfil: "pf",
        numero: "4783080406229275",
        validade: "11/32",
        cvv: "443",
      },
      contexto({
        intencaoPendente: {
          intencao_pendente: "CRIAR_CARTAO",
          dados_parciais: { nome: "Azul Itaú", limite: 12889, perfil: "pf" },
        },
      }),
    );

    expect(resultado).toMatchObject({
      intencao: "CRIAR_CARTAO",
      nome: "Azul Itaú",
      limite: 12889,
      fechamento: 30,
      vencimento: 6,
      perfil: "pf",
      numero: "4783080406229275",
      validade: "11/32",
      cvv: "443",
    });
  });

  it("completa o cartão quando SOLICITAR + pendente já cobrem todos os campos", () => {
    const resultado = normalizar_intencao_cadastro(
      {
        intencao: "SOLICITAR_INFORMACAO",
        intencao_pendente: "CRIAR_CARTAO",
        pergunta: "Qual o limite?",
        dados_parciais: { fechamento: 30, vencimento: 6 },
      },
      contexto({
        intencaoPendente: {
          intencao_pendente: "CRIAR_CARTAO",
          dados_parciais: { nome: "Azul Itaú", limite: 12889 },
        },
      }),
    );

    expect(resultado).toMatchObject({
      intencao: "CRIAR_CARTAO",
      nome: "Azul Itaú",
      limite: 12889,
      fechamento: 30,
      vencimento: 6,
      perfil: "pf",
    });
  });

  it("preserva dados_parciais ao pedir só o que ainda falta", () => {
    const resultado = normalizar_intencao_cadastro(
      {
        intencao: "SOLICITAR_INFORMACAO",
        intencao_pendente: "CRIAR_CARTAO",
        pergunta: "Qual o vencimento?",
        dados_parciais: { fechamento: 30 },
      },
      contexto({
        intencaoPendente: {
          intencao_pendente: "CRIAR_CARTAO",
          dados_parciais: { nome: "Azul Itaú", limite: 12889 },
        },
      }),
    );

    expect(resultado.intencao).toBe("SOLICITAR_INFORMACAO");
    if (resultado.intencao !== "SOLICITAR_INFORMACAO") return;
    expect(resultado.dados_parciais).toMatchObject({
      nome: "Azul Itaú",
      limite: 12889,
      fechamento: 30,
      perfil: "pf",
    });
    expect(resultado.pergunta).toMatch(/vencimento/i);
    expect(resultado.pergunta).not.toMatch(/limite/i);
  });

  it("converte CRIAR_CARTAO incompleto em SOLICITAR_INFORMACAO preservando o que já veio", () => {
    const resultado = normalizar_intencao_cadastro(
      {
        intencao: "CRIAR_CARTAO",
        nome: "Azul Itaú",
        limite: 12889,
      },
      contexto(),
    );

    expect(resultado.intencao).toBe("SOLICITAR_INFORMACAO");
    if (resultado.intencao !== "SOLICITAR_INFORMACAO") return;
    expect(resultado.intencao_pendente).toBe("CRIAR_CARTAO");
    expect(resultado.dados_parciais).toMatchObject({
      nome: "Azul Itaú",
      limite: 12889,
      perfil: "pf",
    });
    expect(resultado.pergunta).toMatch(/fechamento/i);
    expect(resultado.pergunta).toMatch(/vencimento/i);
  });

  it("aceita limite em string no formato brasileiro nos dados parciais", () => {
    const resultado = normalizar_intencao_cadastro(
      {
        intencao: "CRIAR_CARTAO",
        nome: "Azul Itaú",
        fechamento: 30,
        vencimento: 6,
      },
      contexto({
        intencaoPendente: {
          intencao_pendente: "CRIAR_CARTAO",
          dados_parciais: { limite: "12.889,00" },
        },
      }),
    );

    expect(resultado).toMatchObject({
      intencao: "CRIAR_CARTAO",
      limite: 12889,
      fechamento: 30,
      vencimento: 6,
      perfil: "pf",
    });
  });

  it("mescla saldo da conta pendente ao completar o cadastro", () => {
    const resultado = normalizar_intencao_cadastro(
      {
        intencao: "CRIAR_CONTA",
        nome: "Mercado Pago",
        perfil: "pf",
      },
      contexto({
        intencaoPendente: {
          intencao_pendente: "CRIAR_CONTA",
          dados_parciais: { saldo_inicial: 1000 },
        },
      }),
    );

    expect(resultado).toMatchObject({
      intencao: "CRIAR_CONTA",
      nome: "Mercado Pago",
      saldo_inicial: 1000,
      perfil: "pf",
    });
  });
});
