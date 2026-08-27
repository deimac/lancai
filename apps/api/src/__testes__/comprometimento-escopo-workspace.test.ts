import { describe, expect, it } from "vitest";
import { filtrar_compras_do_workspace } from "../servicos/comprometimento-servico";
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
