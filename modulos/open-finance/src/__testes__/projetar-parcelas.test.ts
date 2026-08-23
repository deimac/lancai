import { describe, expect, it } from "vitest";
import {
  agrupar_series_parcelamento,
  eh_id_parcela_projetada,
  id_externo_parcela_projetada,
  planejar_complemento_parcelas_cartao,
  planejar_parcelas_faltantes,
  projetar_data_parcela,
} from "../projetar-parcelas";

describe("projetar-parcelas", () => {
  it("projeta datas a partir da parcela conhecida mais próxima", () => {
    const datas = new Map([
      [1, "2026-06-01"],
      [2, "2026-07-12"],
    ]);
    expect(projetar_data_parcela(datas, 3, "2026-05-14")).toBe("2026-08-01");
    expect(projetar_data_parcela(datas, 4, "2026-05-14")).toBe("2026-09-01");
  });

  it("completa série incompleta (ex. 955022 com só 1 e 2)", () => {
    const series = agrupar_series_parcelamento([
      {
        parcelaNumero: 1,
        parcelaTotal: 4,
        parcelaCompraEm: "2026-05-14",
        parcelaCompraValor: "822.14",
        valor: "205.55",
        dataMovimento: "2026-06-01",
        descricao: "E AGENCIAS*955022",
        idExterno: "a",
        status: "realizado",
        statusFonte: "confirmado",
      },
      {
        parcelaNumero: 2,
        parcelaTotal: 4,
        parcelaCompraEm: "2026-05-14",
        parcelaCompraValor: "822.14",
        valor: "205.53",
        dataMovimento: "2026-07-12",
        descricao: "E AGENCIAS*955022",
        idExterno: "b",
        status: "realizado",
        statusFonte: "confirmado",
      },
    ]);

    expect(series).toHaveLength(1);
    const faltantes = planejar_parcelas_faltantes({
      workspaceId: "11111111-1111-1111-1111-111111111111",
      cartaoId: "22222222-2222-2222-2222-222222222222",
      series,
    });

    expect(faltantes.map((p) => p.numero)).toEqual([3, 4]);
    expect(faltantes[0]?.ocorridoEm).toBe("2026-08-01");
    expect(faltantes[1]?.ocorridoEm).toBe("2026-09-01");
    expect(faltantes[1]?.valor).toBe(205.53);
    expect(eh_id_parcela_projetada(faltantes[1]?.idExterno)).toBe(true);
  });

  it("não racha série por diferença de centavos sem total institucional", () => {
    const series = agrupar_series_parcelamento([
      {
        parcelaNumero: 1,
        parcelaTotal: 5,
        parcelaCompraEm: "2026-05-13",
        parcelaCompraValor: null,
        valor: "477.64",
        dataMovimento: "2026-06-01",
        descricao: "E AGENCIAS*825317",
        idExterno: "a",
        status: "realizado",
        statusFonte: "confirmado",
      },
      {
        parcelaNumero: 2,
        parcelaTotal: 5,
        parcelaCompraEm: "2026-05-13",
        parcelaCompraValor: null,
        valor: "477.60",
        dataMovimento: "2026-07-12",
        descricao: "E AGENCIAS*825317",
        idExterno: "b",
        status: "realizado",
        statusFonte: "confirmado",
      },
    ]);
    expect(series).toHaveLength(1);
    expect(planejar_parcelas_faltantes({
      workspaceId: "11111111-1111-1111-1111-111111111111",
      cartaoId: "22222222-2222-2222-2222-222222222222",
      series,
    }).map((p) => p.numero)).toEqual([3, 4, 5]);
  });

  it("agrupa descrições variantes da mesma compra (KASM / KASMOBILE)", () => {
    const series = agrupar_series_parcelamento([
      {
        parcelaNumero: 6,
        parcelaTotal: 10,
        parcelaCompraEm: "2026-02-27",
        parcelaCompraValor: "615.70",
        valor: "61.57",
        dataMovimento: "2026-08-01",
        descricao: "MERCADOLIVRE*KASMOBILE",
        idExterno: "a",
        status: "previsto",
        statusFonte: "pendente",
      },
      {
        parcelaNumero: 7,
        parcelaTotal: 10,
        parcelaCompraEm: "2026-02-27",
        parcelaCompraValor: "615.70",
        valor: "61.57",
        dataMovimento: "2026-09-01",
        descricao: "MERCADOLIVRE*KASM",
        idExterno: "b",
        status: "previsto",
        statusFonte: "pendente",
      },
    ]);

    expect(series).toHaveLength(1);
    expect(series[0]?.numerosPresentes.has(6)).toBe(true);
    expect(series[0]?.numerosPresentes.has(7)).toBe(true);

    const faltantes = planejar_parcelas_faltantes({
      workspaceId: "11111111-1111-1111-1111-111111111111",
      cartaoId: "22222222-2222-2222-2222-222222222222",
      series,
    });
    expect(faltantes.map((p) => p.numero)).toEqual([1, 2, 3, 4, 5, 8, 9, 10]);
  });

  it("gera id_externo estável por série+número", () => {
    const a = id_externo_parcela_projetada({
      workspaceId: "11111111-1111-1111-1111-111111111111",
      cartaoId: "22222222-2222-2222-2222-222222222222",
      compraEm: "2026-05-14",
      total: 4,
      valorCompra: "822.14",
      numero: 4,
    });
    const b = id_externo_parcela_projetada({
      workspaceId: "11111111-1111-1111-1111-111111111111",
      cartaoId: "22222222-2222-2222-2222-222222222222",
      compraEm: "2026-05-14",
      total: 4,
      valorCompra: "822.14",
      numero: 4,
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^lancai:proj:[0-9a-f]{16}:4$/);
  });

  it("preserva o dia da parcela conhecida na fatura PDF (1/4 em 13/07 → 13/08)", () => {
    const eventos = planejar_complemento_parcelas_cartao({
      workspaceId: "11111111-1111-1111-1111-111111111111",
      cartaoId: "22222222-2222-2222-2222-222222222222",
      fonte: "pdf",
      provedor: "revolut-pdf",
      preservarDia: true,
      movimentos: [
        {
          parcelaNumero: 1,
          parcelaTotal: 4,
          parcelaCompraEm: "2026-07-13",
          parcelaCompraValor: "1900.00",
          valor: "475.00",
          dataMovimento: "2026-07-13",
          descricao: "Moacyr Sanches Mascar",
          idExterno: "pdf-1",
          status: "realizado",
          statusFonte: "confirmado",
        },
      ],
    });

    expect(eventos.map((e) => e.parcelamento?.numero)).toEqual([2, 3, 4]);
    expect(eventos.map((e) => e.ocorridoEm)).toEqual(["2026-08-13", "2026-09-13", "2026-10-13"]);
    expect(eventos.every((e) => e.statusFonte === "pendente")).toBe(true);
    expect(eventos.every((e) => e.fonte === "pdf")).toBe(true);
    expect(eventos[0]?.valor).toBe(475);
  });
});
