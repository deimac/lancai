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
});
