import { describe, expect, it } from "vitest";
import {
  aplicar_fatos_open_finance,
  type MetaOrigem,
} from "../servicos/origem-conta-cartao";

const MANUAL: MetaOrigem = {
  origem: "manual",
  conexaoId: null,
  instituicao: null,
  idExterno: null,
  conexaoStatus: null,
  ultimoSyncEm: null,
};

describe("aplicar_fatos_open_finance", () => {
  it("marca origem open_finance sem conexaoId quando há Fato OF", () => {
    const id = "cartao-azul";
    const mapa = new Map<string, MetaOrigem>([[id, { ...MANUAL }]]);
    aplicar_fatos_open_finance(mapa, [id]);
    expect(mapa.get(id)).toMatchObject({
      origem: "open_finance",
      conexaoId: null,
      conexaoStatus: "removida",
    });
  });

  it("não sobrescreve quem já tem mapa OF (Mercado Pago)", () => {
    const id = "cartao-mp";
    const mapa = new Map<string, MetaOrigem>([
      [
        id,
        {
          origem: "open_finance",
          conexaoId: "conexao-mp",
          instituicao: "Mercado Pago",
          idExterno: "card-mp",
          conexaoStatus: "ativa",
          ultimoSyncEm: null,
        },
      ],
    ]);
    aplicar_fatos_open_finance(mapa, [id]);
    expect(mapa.get(id)?.conexaoId).toBe("conexao-mp");
    expect(mapa.get(id)?.conexaoStatus).toBe("ativa");
  });

  it("deixa manual quem não tem Fato OF — a UI não mostra Reconectar", () => {
    const id = "cartao-manual";
    const mapa = new Map<string, MetaOrigem>([[id, { ...MANUAL }]]);
    aplicar_fatos_open_finance(mapa, []);
    expect(mapa.get(id)?.origem).toBe("manual");
    expect(mapa.get(id)?.conexaoId).toBeNull();
  });
});
