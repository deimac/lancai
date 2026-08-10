import { describe, expect, it } from "vitest";
import { normalizar_intencao_recorrencia } from "../normalizar-intencao-recorrencia";
import type { ContextoInterpretacao } from "../prompt";

function contexto(parcial: Partial<ContextoInterpretacao> = {}): ContextoInterpretacao {
  return {
    dataAtual: "2026-08-05",
    contas: [],
    cartoes: [{ nome: "Nubank", perfil: "pf", modalidade: "credito", temConta: false }],
    categorias: [{ nome: "Assinaturas", tipo: "despesa" }],
    pessoas: [],
    habitos: [],
    historicoRecente: [],
    intencaoPendente: null,
    nomeUsuario: "Deividy Silva",
    ...parcial,
  };
}

describe("normalizar_intencao_recorrencia", () => {
  it("pergunta o valor quando falta (com nome)", () => {
    const r = normalizar_intencao_recorrencia(
      {
        intencao: "CRIAR_RECORRENCIA",
        descricao: "Netflix",
        valor: null,
        dia_do_mes: 10,
        cartao_nome: "Nubank",
        tipo_movimento: "despesa",
      },
      contexto(),
    );
    expect(r.intencao).toBe("SOLICITAR_INFORMACAO");
    if (r.intencao !== "SOLICITAR_INFORMACAO") return;
    expect(r.intencao_pendente).toBe("CRIAR_RECORRENCIA");
    expect(r.pergunta).toBe("Deividy, qual é o valor?");
    expect(r.dados_parciais).toMatchObject({
      descricao: "Netflix",
      dia_do_mes: 10,
      cartao_nome: "Nubank",
    });
  });

  it("completa com valor da resposta curta + dados pendentes", () => {
    const r = normalizar_intencao_recorrencia(
      {
        intencao: "CRIAR_RECORRENCIA",
        descricao: "Recorrência",
        valor: 55.9,
        dia_do_mes: null,
        tipo_movimento: "despesa",
      },
      contexto({
        intencaoPendente: {
          intencao_pendente: "CRIAR_RECORRENCIA",
          dados_parciais: {
            descricao: "Netflix",
            dia_do_mes: 10,
            cartao_nome: "Nubank",
            tipo_movimento: "despesa",
          },
        },
      }),
      "55,90",
    );
    expect(r).toMatchObject({
      intencao: "CRIAR_RECORRENCIA",
      descricao: "Netflix",
      valor: 55.9,
      dia_do_mes: 10,
      cartao_nome: "Nubank",
    });
  });

  it("não confunde dia 10 com valor ao mesclar", () => {
    const r = normalizar_intencao_recorrencia(
      {
        intencao: "CRIAR_RECORRENCIA",
        descricao: "Netflix",
        valor: null,
        dia_do_mes: 10,
        cartao_nome: "Nubank",
      },
      contexto(),
      "Todo mês dia 10 Netflix no Nubank",
    );
    expect(r.intencao).toBe("SOLICITAR_INFORMACAO");
    if (r.intencao !== "SOLICITAR_INFORMACAO") return;
    expect(r.dados_parciais?.valor).toBeUndefined();
  });

  it.each([
    ["hoje", 9],
    ["hj", 9],
    ["esse mes", 9],
    ["este mês", 9],
    ["agosto", 9],
    ["dia 09", 9],
    ["dia 9", 9],
    ["10", 10],
  ])("aceita %s como dia do mês na resposta ao slot", (resposta, dia) => {
    const r = normalizar_intencao_recorrencia(
      {
        intencao: "CRIAR_RECORRENCIA",
        descricao: "Recorrência",
        valor: null,
        dia_do_mes: null,
        tipo_movimento: "despesa",
      },
      contexto({
        dataAtual: "2026-08-09",
        intencaoPendente: {
          intencao_pendente: "CRIAR_RECORRENCIA",
          dados_parciais: {
            descricao: "Netflix",
            valor: 28,
            cartao_nome: "Nubank",
            tipo_movimento: "despesa",
          },
        },
      }),
      resposta,
    );
    expect(r).toMatchObject({
      intencao: "CRIAR_RECORRENCIA",
      descricao: "Netflix",
      valor: 28,
      dia_do_mes: dia,
      cartao_nome: "Nubank",
    });
  });

  it("trata 'Valor de 28' como origem inválida e pergunta conta/cartão após o dia", () => {
    const r = normalizar_intencao_recorrencia(
      {
        intencao: "CRIAR_RECORRENCIA",
        descricao: "Recorrência",
        valor: null,
        dia_do_mes: null,
        tipo_movimento: "despesa",
      },
      contexto({
        dataAtual: "2026-08-09",
        intencaoPendente: {
          intencao_pendente: "CRIAR_RECORRENCIA",
          dados_parciais: {
            descricao: "Assinatura da netflix",
            valor: 28,
            cartao_nome: "Valor de 28",
            tipo_movimento: "despesa",
          },
        },
      }),
      "hoje",
    );
    expect(r.intencao).toBe("SOLICITAR_INFORMACAO");
    if (r.intencao !== "SOLICITAR_INFORMACAO") return;
    expect(r.intencao_pendente).toBe("CRIAR_RECORRENCIA");
    expect(r.pergunta).toMatch(/conta ou cartão/i);
    expect(r.dados_parciais).toMatchObject({
      descricao: "Assinatura da netflix",
      valor: 28,
      dia_do_mes: 9,
    });
    expect(r.dados_parciais?.cartao_nome).toBeUndefined();
  });

  it("mantém Nubank explícito sem pedir origem de novo", () => {
    const r = normalizar_intencao_recorrencia(
      {
        intencao: "CRIAR_RECORRENCIA",
        descricao: "Netflix",
        valor: 55,
        dia_do_mes: 10,
        cartao_nome: "Nubank",
        tipo_movimento: "despesa",
      },
      contexto(),
    );
    expect(r).toMatchObject({
      intencao: "CRIAR_RECORRENCIA",
      descricao: "Netflix",
      valor: 55,
      dia_do_mes: 10,
      cartao_nome: "Nubank",
    });
  });

  it("fluxo: valor sem origem → pede dia → hoje → pede conta/cartão", () => {
    const ctxBase = contexto({ dataAtual: "2026-08-09" });
    const passo1 = normalizar_intencao_recorrencia(
      {
        intencao: "CRIAR_RECORRENCIA",
        descricao: "Netflix",
        valor: 28,
        dia_do_mes: null,
        conta_nome: null,
        cartao_nome: null,
        tipo_movimento: "despesa",
      },
      ctxBase,
      "faca um lancamento recorrente de assinatura da netflix no valor de 28",
    );
    expect(passo1.intencao).toBe("SOLICITAR_INFORMACAO");
    if (passo1.intencao !== "SOLICITAR_INFORMACAO") return;
    expect(passo1.pergunta).toMatch(/dia/i);

    const passo2 = normalizar_intencao_recorrencia(
      {
        intencao: "CRIAR_RECORRENCIA",
        descricao: "Recorrência",
        valor: null,
        dia_do_mes: null,
        tipo_movimento: "despesa",
      },
      contexto({
        dataAtual: "2026-08-09",
        intencaoPendente: {
          intencao_pendente: "CRIAR_RECORRENCIA",
          dados_parciais: passo1.dados_parciais ?? {},
        },
      }),
      "hoje",
    );
    expect(passo2.intencao).toBe("SOLICITAR_INFORMACAO");
    if (passo2.intencao !== "SOLICITAR_INFORMACAO") return;
    expect(passo2.pergunta).toMatch(/conta ou cartão/i);
    expect(passo2.dados_parciais).toMatchObject({ valor: 28, dia_do_mes: 9 });
  });
});
