import { describe, expect, it, vi } from "vitest";
import {
  ClassificadorCategoria,
  classificacao_ia_habilitada,
} from "../classificador-categoria";
import type { OrquestradorIA } from "../orquestrador-ia";

describe("ClassificadorCategoria", () => {
  it("resolve o nome sugerido para o id da lista", async () => {
    const orquestrador = {
      gerar_objeto_estruturado: vi.fn().mockResolvedValue({
        categoria_nome: "combustível",
        confianca: 0.77,
      }),
    } as unknown as OrquestradorIA;

    const classificador = new ClassificadorCategoria(orquestrador);
    const combustivelId = "00000000-0000-4000-8000-000000000001";
    const resultado = await classificador.sugerir({
      descricao: "Gasolina",
      descricaoFonte: "POSTO IPIRANGA",
      favorecidoFonte: null,
      tipo: "despesa",
      categorias: [
        { id: combustivelId, nome: "Combustível" },
        { id: "00000000-0000-4000-8000-000000000002", nome: "Lazer" },
      ],
    });

    expect(resultado).toEqual({ categoriaId: combustivelId, confianca: 0.77 });
  });

  it("devolve null quando o modelo inventa categoria fora da lista", async () => {
    const orquestrador = {
      gerar_objeto_estruturado: vi.fn().mockResolvedValue({
        categoria_nome: "Delivery",
        confianca: 0.9,
      }),
    } as unknown as OrquestradorIA;

    const classificador = new ClassificadorCategoria(orquestrador);
    const resultado = await classificador.sugerir({
      descricao: "IFOOD",
      descricaoFonte: "IFOOD",
      favorecidoFonte: null,
      tipo: "despesa",
      categorias: [{ id: "00000000-0000-4000-8000-000000000001", nome: "Alimentação" }],
    });

    expect(resultado).toBeNull();
  });
});

describe("classificacao_ia_habilitada", () => {
  it("liga por padrão e respeita desligar via env", () => {
    expect(classificacao_ia_habilitada({})).toBe(true);
    expect(classificacao_ia_habilitada({ CLASSIFICACAO_IA_HABILITADA: "false" })).toBe(false);
    expect(classificacao_ia_habilitada({ CLASSIFICACAO_IA_HABILITADA: "off" })).toBe(false);
  });
});
