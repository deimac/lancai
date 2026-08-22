import { describe, expect, it } from "vitest";
import { detectar_padroes_recorrentes, padrao_estavel_para_gerar } from "../padroes-recorrentes";

const DATA = "2026-08-15";

function despesa(parcial: {
  descricao: string;
  valor: string;
  dataMovimento: string;
  parcelaTotal?: number | null;
  parcelaCompraEm?: string | null;
  cartaoId?: string | null;
}) {
  return {
    descricao: parcial.descricao,
    valor: parcial.valor,
    dataMovimento: parcial.dataMovimento,
    tipo: "despesa",
    cartaoId: parcial.cartaoId ?? null,
    contaId: "conta",
    parcelaTotal: parcial.parcelaTotal ?? null,
    parcelaCompraEm: parcial.parcelaCompraEm ?? null,
    categoriaId: "cat",
  };
}

describe("detectar_padroes_recorrentes", () => {
  it("reconhece a mesma assinatura em dois meses consecutivos vigentes", () => {
    const padroes = detectar_padroes_recorrentes(
      [
        despesa({ descricao: "Netflix", valor: "55.90", dataMovimento: "2026-07-10" }),
        despesa({ descricao: "NETFLIX", valor: "55.90", dataMovimento: "2026-08-10" }),
        despesa({
          descricao: "LATAM",
          valor: "400.00",
          dataMovimento: "2026-08-10",
          cartaoId: "cartao",
          parcelaTotal: 3,
          parcelaCompraEm: "2026-06-01",
        }),
      ],
      DATA,
    );
    expect(padroes).toHaveLength(1);
    expect(padroes[0]?.descricao).toBe("Netflix");
    expect(padroes[0]?.valor).toBe(55.9);
    expect(padroes[0]?.diaDoMes).toBe(10);
  });

  it("não trata compra única como recorrente", () => {
    expect(
      detectar_padroes_recorrentes(
        [despesa({ descricao: "Uber", valor: "32.00", dataMovimento: "2026-08-10" })],
        DATA,
      ),
    ).toEqual([]);
  });

  it("ignora assinatura que parou há mais de um mês", () => {
    expect(
      detectar_padroes_recorrentes(
        [
          despesa({ descricao: "Gympass", valor: "99.00", dataMovimento: "2026-02-05" }),
          despesa({ descricao: "Gympass", valor: "99.00", dataMovimento: "2026-03-05" }),
        ],
        DATA,
      ),
    ).toEqual([]);
  });

  it("ignora coincidência de valor em dias diferentes (Uber)", () => {
    expect(
      detectar_padroes_recorrentes(
        [
          despesa({ descricao: "Uber", valor: "18.00", dataMovimento: "2026-07-03" }),
          despesa({ descricao: "Uber", valor: "18.00", dataMovimento: "2026-08-22" }),
        ],
        DATA,
      ),
    ).toEqual([]);
  });

  it("Claro mensal sem o mês corrente continua vigente e estável para gerar", () => {
    const padroes = detectar_padroes_recorrentes(
      [
        despesa({
          descricao: "CLARO *11992138303SOROCABABR",
          valor: "65.83",
          dataMovimento: "2026-05-11",
          cartaoId: "itau",
        }),
        despesa({
          descricao: "CLARO *11992138303SOROCABABR",
          valor: "65.83",
          dataMovimento: "2026-06-11",
          cartaoId: "itau",
        }),
        despesa({
          descricao: "CLARO *11992138303SOROCABABR",
          valor: "65.83",
          dataMovimento: "2026-07-11",
          cartaoId: "itau",
        }),
      ],
      "2026-08-22",
    );
    expect(padroes).toHaveLength(1);
    expect(padroes[0]?.diaDoMes).toBe(11);
    expect(padrao_estavel_para_gerar(padroes[0]!)).toBe(true);
  });

  it("dois iFoods iguais no mesmo dia do mês não passam do piso para gerar", () => {
    const padroes = detectar_padroes_recorrentes(
      [
        despesa({
          descricao: "IFD*IFOOD CLUB",
          valor: "7.95",
          dataMovimento: "2026-07-18",
          cartaoId: "itau",
        }),
        despesa({
          descricao: "IFD*IFOOD CLUB",
          valor: "7.95",
          dataMovimento: "2026-08-18",
          cartaoId: "itau",
        }),
      ],
      DATA,
    );
    expect(padroes).toHaveLength(1);
    expect(padrao_estavel_para_gerar(padroes[0]!)).toBe(false);
  });
});
