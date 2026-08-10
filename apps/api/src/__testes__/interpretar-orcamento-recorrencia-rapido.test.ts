import { describe, expect, it } from "vitest";
import {
  interpretar_orcamento_rapido,
  interpretar_recorrencia_rapida,
} from "../servicos/interpretar-orcamento-recorrencia-rapido";

describe("interpretar_orcamento_rapido", () => {
  it("define orçamento por categoria", () => {
    const r = interpretar_orcamento_rapido("orçamento de alimentação 800");
    expect(r).toMatchObject({
      intencao: "DEFINIR_ORCAMENTO",
      valor_limite: 800,
      categoria_nome: "alimentação",
    });
  });

  it("consulta orçamento", () => {
    expect(interpretar_orcamento_rapido("como está meu orçamento?")).toMatchObject({
      intencao: "CONSULTAR_ORCAMENTO",
    });
  });
});

describe("interpretar_recorrencia_rapida", () => {
  it("cria recorrência todo mês", () => {
    const r = interpretar_recorrencia_rapida("todo mês dia 10 Netflix 55");
    expect(r).toMatchObject({
      intencao: "CRIAR_RECORRENCIA",
      dia_do_mes: 10,
      valor: 55,
    });
    expect(r && "descricao" in r ? r.descricao.toLowerCase() : "").toContain("netflix");
  });

  it("aceita recorrência sem valor (para o normalizador perguntar)", () => {
    const r = interpretar_recorrencia_rapida("Todo mês dia 10 Netflix no Nubank", {
      dataAtual: "2026-08-05",
      contas: [],
      cartoes: [{ nome: "Nubank", perfil: "pf", modalidade: "credito", temConta: false }],
      categorias: [],
      pessoas: [],
      habitos: [],
      historicoRecente: [],
      intencaoPendente: null,
    });
    expect(r).toMatchObject({
      intencao: "CRIAR_RECORRENCIA",
      dia_do_mes: 10,
      valor: null,
      cartao_nome: "Nubank",
    });
    expect(r && "descricao" in r ? r.descricao.toLowerCase() : "").toContain("netflix");
  });

  it("completa valor em resposta curta com pendência", () => {
    const r = interpretar_recorrencia_rapida("55,90", {
      dataAtual: "2026-08-05",
      contas: [],
      cartoes: [{ nome: "Nubank", perfil: "pf", modalidade: "credito", temConta: false }],
      categorias: [],
      pessoas: [],
      habitos: [],
      historicoRecente: [],
      intencaoPendente: {
        intencao_pendente: "CRIAR_RECORRENCIA",
        dados_parciais: {
          descricao: "Netflix",
          dia_do_mes: 10,
          cartao_nome: "Nubank",
        },
      },
    });
    expect(r).toMatchObject({
      intencao: "CRIAR_RECORRENCIA",
      descricao: "Netflix",
      valor: 55.9,
      dia_do_mes: 10,
      cartao_nome: "Nubank",
    });
  });

  it("completa dia com 'hoje' na resposta curta", () => {
    const r = interpretar_recorrencia_rapida("hoje", {
      dataAtual: "2026-08-09",
      contas: [],
      cartoes: [{ nome: "Nubank", perfil: "pf", modalidade: "credito", temConta: false }],
      categorias: [],
      pessoas: [],
      habitos: [],
      historicoRecente: [],
      intencaoPendente: {
        intencao_pendente: "CRIAR_RECORRENCIA",
        dados_parciais: {
          descricao: "Netflix",
          valor: 28,
          cartao_nome: "Nubank",
        },
      },
    });
    expect(r).toMatchObject({
      intencao: "CRIAR_RECORRENCIA",
      descricao: "Netflix",
      valor: 28,
      dia_do_mes: 9,
      cartao_nome: "Nubank",
    });
  });

  it("lista recorrências", () => {
    expect(interpretar_recorrencia_rapida("listar recorrências")).toMatchObject({
      intencao: "LISTAR_RECORRENCIAS",
    });
  });
});
