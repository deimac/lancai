import { describe, expect, it } from "vitest";
import {
  interpretar_consulta_rapida,
  interpretar_pedido_detalhe_historico,
} from "../interpretar-consulta-rapida";
import type { ContextoInterpretacao } from "../prompt";

function contexto(parcial: Partial<ContextoInterpretacao> = {}): ContextoInterpretacao {
  return {
    dataAtual: "2026-08-03",
    contas: [
      { nome: "C6 Bank", perfil: "pf" },
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

describe("interpretar_consulta_rapida", () => {
  it("lista lançamentos de hoje sem IA", () => {
    expect(interpretar_consulta_rapida("quais os lancamentos de hoje?", contexto())).toEqual({
      intencao: "CONSULTAR_VISAO",
      tipo_visao: "historico",
      detalhado: true,
      filtros: {
        periodo: { de: "2026-08-03", ate: "2026-08-03" },
        conta_nome: null,
        cartao_nome: null,
      },
    });
  });

  it("filtra cartão e ontem", () => {
    expect(
      interpretar_consulta_rapida("quanto gastei no cartao azul ontem?", contexto()),
    ).toMatchObject({
      intencao: "CONSULTAR_VISAO",
      tipo_visao: "historico",
      detalhado: false,
      filtros: {
        periodo: { de: "2026-08-02", ate: "2026-08-02" },
        cartao_nome: "Azul Itaú",
      },
    });
  });

  it("consulta gasto do mês sem IA", () => {
    expect(interpretar_consulta_rapida("Quanto gastei esse mês?", contexto())).toEqual({
      intencao: "CONSULTAR_VISAO",
      tipo_visao: "historico",
      detalhado: false,
      filtros: {
        periodo: { de: "2026-08-01", ate: "2026-08-31" },
        conta_nome: null,
        cartao_nome: null,
      },
    });
  });

  it("resumo do mês sem IA", () => {
    expect(interpretar_consulta_rapida("resumo do mês", contexto())).toMatchObject({
      intencao: "CONSULTAR_VISAO",
      tipo_visao: "historico",
      detalhado: false,
      filtros: { periodo: { de: "2026-08-01", ate: "2026-08-31" } },
    });
  });

  it("consulta saldo e saldo de conta", () => {
    expect(interpretar_consulta_rapida("qual o saldo total?", contexto())).toMatchObject({
      intencao: "CONSULTAR_VISAO",
      tipo_visao: "saldos",
    });
    expect(interpretar_consulta_rapida("saldo do Nubank", contexto())).toMatchObject({
      intencao: "CONSULTAR_VISAO",
      tipo_visao: "saldos",
      filtros: { conta_nome: "Nubank" },
    });
  });

  it("deixa a IA interpretar gasto por estabelecimento ou categoria sem dia", () => {
    expect(interpretar_consulta_rapida("quanto gastei de uber?", contexto())).toBeNull();
    expect(interpretar_consulta_rapida("quanto gastei com Transporte?", contexto())).toBeNull();
  });

  it("não intercepta lançamento nem exclusão", () => {
    expect(interpretar_consulta_rapida("gastei 18 na farmacia no cartao azul", contexto())).toBeNull();
    expect(interpretar_consulta_rapida("apague o lancamento de farmacia", contexto())).toBeNull();
  });
});

describe("interpretar_pedido_detalhe_historico", () => {
  const ultimaConsulta = {
    intencao: "CONSULTAR_VISAO" as const,
    tipo_visao: "historico" as const,
    detalhado: false,
    filtros: {
      periodo: { de: "2026-08-01", ate: "2026-08-31" },
      descricao: "uber",
    },
  };

  it("reaproveita filtros da última consulta ao pedir detalhado", () => {
    expect(interpretar_pedido_detalhe_historico("detalhado", ultimaConsulta)).toEqual({
      ...ultimaConsulta,
      detalhado: true,
    });
    expect(interpretar_pedido_detalhe_historico("mostra detalhado", ultimaConsulta)).toMatchObject({
      detalhado: true,
      filtros: { descricao: "uber" },
    });
  });

  it("ignora se não houver consulta de histórico anterior", () => {
    expect(interpretar_pedido_detalhe_historico("detalhado", null)).toBeNull();
    expect(
      interpretar_pedido_detalhe_historico("detalhado", {
        intencao: "CONSULTAR_VISAO",
        tipo_visao: "saldos",
        filtros: {},
      }),
    ).toBeNull();
    expect(interpretar_pedido_detalhe_historico("quanto gastei esse mês?", ultimaConsulta)).toBeNull();
  });
});
