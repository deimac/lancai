import { describe, expect, it } from "vitest";
import { filtrar_compras_do_workspace, perfil_do_destino_maps, recortar_por_tipo_gasto } from "../servicos/comprometimento-servico";
import type { CompraParcelada } from "@lancai/relatorios";

function compra(sobrepor: Partial<CompraParcelada> & Pick<CompraParcelada, "descricao" | "cartaoId" | "tipoGasto">): CompraParcelada {
  return {
    cartaoNome: "cartão",
    valorTotal: 100,
    valorParcela: 10,
    parcelasTotais: 10,
    parcelasPagas: 1,
    parcelasRestantes: 9,
    valorRestante: 90,
    proximaParcelaData: "2026-09-01",
    parcelasPorMes: [],
    ...sobrepor,
  };
}

describe("filtrar_compras_do_workspace", () => {
  const pessoal = { id: "cartao-nu", perfil: "pf" };
  const empresa = { id: "cartao-mp", perfil: "pj" };

  const kasmobile = compra({
    descricao: "MERCADOLIVRE*KASMOBILE",
    cartaoId: empresa.id,
    cartaoNome: "Mercado Pago Visa",
    tipoGasto: "pj",
  });
  const hotel = compra({
    descricao: "HOTELDOBARUERIBR",
    cartaoId: pessoal.id,
    cartaoNome: "Azul Itaú Visa Platinum",
    tipoGasto: "pj",
  });
  const netflix = compra({
    descricao: "Netflix",
    cartaoId: pessoal.id,
    cartaoNome: "Nu Mastercard Platinum",
    tipoGasto: "pf",
  });

  it("na visão Geral mantém compras dos dois workspaces", () => {
    expect(
      filtrar_compras_do_workspace([kasmobile, hotel, netflix], {
        visaoAgregada: true,
        cartoes: [pessoal],
      }),
    ).toEqual([kasmobile, hotel, netflix]);
  });

  it("no Pessoal não lista o parcelado do cartão da Empresa", () => {
    const visiveis = filtrar_compras_do_workspace([kasmobile, hotel, netflix], {
      visaoAgregada: false,
      cartoes: [pessoal],
    });
    expect(visiveis.map((item) => item.descricao)).toEqual(["Netflix"]);
  });

  it("no Pessoal não lista gasto empresa em cartão pessoal", () => {
    const visiveis = filtrar_compras_do_workspace([hotel, netflix], {
      visaoAgregada: false,
      cartoes: [pessoal],
    });
    expect(visiveis.map((item) => item.descricao)).toEqual(["Netflix"]);
  });
});

describe("perfil_do_destino_maps", () => {
  const cartoes = new Map([
    ["cartao-pf", "pf"],
    ["cartao-pj", "pj"],
  ]);
  const contas = new Map([
    ["conta-pf", "pf"],
    ["conta-pj", "pj"],
  ]);

  it("usa o perfil do cartão quando há cartão", () => {
    expect(perfil_do_destino_maps("cartao-pj", "conta-pf", cartoes, contas)).toBe("pj");
  });

  it("cai na conta quando não há cartão", () => {
    expect(perfil_do_destino_maps(null, "conta-pj", cartoes, contas)).toBe("pj");
  });

  it("assume pf sem destino", () => {
    expect(perfil_do_destino_maps(null, null, cartoes, contas)).toBe("pf");
  });
});

describe("recortar_por_tipo_gasto", () => {
  it("sem perfil mantém tudo", () => {
    const itens = [{ tipoGasto: "pf" }, { tipoGasto: "pj" }];
    expect(recortar_por_tipo_gasto(itens, undefined)).toEqual(itens);
  });

  it("recorta compras e recorrentes pela natureza", () => {
    const compras = [
      { descricao: "Netflix", tipoGasto: "pf" },
      { descricao: "Kasmobile", tipoGasto: "pj" },
    ];
    expect(recortar_por_tipo_gasto(compras, "pf").map((item) => item.descricao)).toEqual(["Netflix"]);
    expect(recortar_por_tipo_gasto(compras, "pj").map((item) => item.descricao)).toEqual(["Kasmobile"]);
  });
});
