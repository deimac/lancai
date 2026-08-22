import { describe, expect, it } from "vitest";
import { padrao_estavel_para_gerar } from "@lancai/relatorios";
import {
  chave_identidade_recorrencia,
  data_liberacao_geracao,
  deve_gerar_recorrencia,
  ja_existe_cobranca_equivalente,
  padrao_ja_conhecido,
} from "../servicos/recorrencia-servico";

function cobranca(
  sobrepor: Partial<Parameters<typeof ja_existe_cobranca_equivalente>[0]["movimentos"][number]> = {},
) {
  return {
    descricao: "NETFLIX.COM",
    descricaoFonte: "NETFLIX.COM",
    favorecidoFonte: null as string | null,
    valor: "55.90",
    tipo: "despesa",
    contaId: "conta-1",
    cartaoId: null as string | null,
    status: "realizado",
    fonte: "open_finance",
    ...sobrepor,
  };
}

describe("ja_existe_cobranca_equivalente", () => {
  const netflix = {
    descricao: "Netflix",
    valor: 55.9,
    tipo: "despesa",
    contaId: "conta-1",
    cartaoId: null as string | null,
  };

  it("reconhece Fato OF do mesmo mês, conta, valor e descrição", () => {
    expect(
      ja_existe_cobranca_equivalente({
        ...netflix,
        movimentos: [cobranca()],
      }),
    ).toBe(true);
  });

  it("não casa valor diferente", () => {
    expect(
      ja_existe_cobranca_equivalente({
        ...netflix,
        movimentos: [cobranca({ valor: "39.90" })],
      }),
    ).toBe(false);
  });

  it("não casa conta diferente", () => {
    expect(
      ja_existe_cobranca_equivalente({
        ...netflix,
        movimentos: [cobranca({ contaId: "conta-2" })],
      }),
    ).toBe(false);
  });

  it("ignora o próprio lançamento gerado pela recorrência", () => {
    expect(
      ja_existe_cobranca_equivalente({
        ...netflix,
        movimentos: [cobranca({ fonte: "recorrencia", descricao: "Netflix", descricaoFonte: "Netflix" })],
      }),
    ).toBe(false);
  });

  it("ignora cancelado", () => {
    expect(
      ja_existe_cobranca_equivalente({
        ...netflix,
        movimentos: [cobranca({ status: "cancelado" })],
      }),
    ).toBe(false);
  });

  it("reconhece Claro OF do cartão quando a fatura fecha", () => {
    expect(
      ja_existe_cobranca_equivalente({
        descricao: "CLARO *11992138303SOROCABABR",
        valor: 65.83,
        tipo: "despesa",
        cartaoId: "itau",
        movimentos: [
          cobranca({
            descricao: "CLARO *11992138303SOROCABABR",
            descricaoFonte: "CLARO  *11992138303SOROCABABR",
            valor: "65.83",
            contaId: null,
            cartaoId: "itau",
          }),
        ],
      }),
    ).toBe(true);
  });
});

describe("deve_gerar_recorrencia", () => {
  const claro = {
    diaDoMes: 11,
    origem: "detectada" as const,
    ultimaGeracao: null as string | null,
  };

  it("não gera Claro no dia 11 — espera a carência do Open Finance", () => {
    expect(deve_gerar_recorrencia({ ...claro, dataRef: "2026-08-11" })).toBe(false);
    expect(deve_gerar_recorrencia({ ...claro, dataRef: "2026-08-13" })).toBe(false);
  });

  it("gera Claro no dia 11 + 3 quando o OF do mês ainda não chegou", () => {
    expect(deve_gerar_recorrencia({ ...claro, dataRef: "2026-08-14" })).toBe(true);
    expect(deve_gerar_recorrencia({ ...claro, dataRef: "2026-08-22" })).toBe(true);
  });

  it("não gera de novo no mesmo mês", () => {
    expect(
      deve_gerar_recorrencia({ ...claro, dataRef: "2026-08-14", ultimaGeracao: "2026-08" }),
    ).toBe(false);
  });

  it("cadastro gera no próprio dia, sem carência", () => {
    expect(
      deve_gerar_recorrencia({
        dataRef: "2026-08-10",
        diaDoMes: 10,
        origem: "cadastro",
        ultimaGeracao: null,
      }),
    ).toBe(true);
    expect(
      deve_gerar_recorrencia({
        dataRef: "2026-08-09",
        diaDoMes: 10,
        origem: "cadastro",
        ultimaGeracao: null,
      }),
    ).toBe(false);
  });
});

describe("data_liberacao_geracao", () => {
  it("não atravessa o mês quando dia + carência passa do último dia", () => {
    expect(data_liberacao_geracao("2026-08", 30, 3)).toBe("2026-08-31");
  });
});

describe("opt-out e piso de 3 meses", () => {
  const claro = {
    descricao: "CLARO *11992138303SOROCABABR",
    valor: 65.83,
    contaId: null,
    cartaoId: "itau",
    categoriaId: "cat",
    mesesObservados: ["2026-05", "2026-06", "2026-07"],
    diaDoMes: 11,
  };

  it("reconhece Claro estável para gerar e iFood de 2 meses não", () => {
    expect(padrao_estavel_para_gerar(claro)).toBe(true);
    expect(
      padrao_estavel_para_gerar({
        descricao: "IFD*IFOOD",
        valor: 47.47,
        contaId: null,
        cartaoId: "itau",
        categoriaId: "cat",
        mesesObservados: ["2026-07", "2026-08"],
        diaDoMes: 8,
      }),
    ).toBe(false);
  });

  it("opt-out: identidade inativa impede rematerializar o mesmo padrão", () => {
    expect(
      padrao_ja_conhecido(claro, [
        {
          descricao: "CLARO *11992138303SOROCABABR",
          valor: "65.83",
          contaId: null,
          cartaoId: "itau",
        },
      ]),
    ).toBe(true);
    expect(
      chave_identidade_recorrencia(claro) ===
        chave_identidade_recorrencia({
          descricao: "claro *11992138303sorocababr",
          valor: 65.83,
          cartaoId: "itau",
        }),
    ).toBe(true);
  });
});
