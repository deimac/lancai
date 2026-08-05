import { describe, expect, it } from "vitest";
import { interpretar_consulta_rapida } from "../interpretar-consulta-rapida";
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

describe("interpretar_consulta_rapida", () => {
  it("lista lançamentos de hoje sem IA", () => {
    expect(interpretar_consulta_rapida("quais os lancamentos de hoje?", contexto())).toEqual({
      intencao: "CONSULTAR_VISAO",
      tipo_visao: "historico",
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
      filtros: {
        periodo: { de: "2026-08-02", ate: "2026-08-02" },
        cartao_nome: "Azul Itaú",
      },
    });
  });

  it("consulta saldo", () => {
    expect(interpretar_consulta_rapida("qual o saldo total?", contexto())).toMatchObject({
      intencao: "CONSULTAR_VISAO",
      tipo_visao: "saldos",
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
