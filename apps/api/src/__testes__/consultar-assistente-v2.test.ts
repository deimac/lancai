import { describe, expect, it, vi } from "vitest";
import type { ModuloRelatorios } from "@lancai/relatorios";
import { consultar_assistente_v2 } from "../servicos/consultar-assistente-v2";

const MOV = "00000000-0000-4000-8000-000000000101";
const USER = "00000000-0000-4000-8000-000000000001";

describe("consultar_assistente_v2", () => {
  it("usa histórico e devolve ids + texto formatado", async () => {
    const relatorios = {
      consultar_visao: vi.fn(async () => ({
        tipo: "historico" as const,
        dados: {
          periodo: { de: "2026-08-01", ate: "2026-08-23" },
          filtroDescricao: "Uber",
          totalReceitas: 0,
          totalDespesas: 50,
          saldoPeriodo: -50,
          totalItens: 1,
          itensOmitidos: 0,
          deslocamento: 0,
          dias: [
            {
              data: "2026-08-23",
              itens: [
                {
                  id: MOV,
                  descricao: "Uber",
                  tipo: "despesa",
                  valor: 50,
                  perfil: "pf" as const,
                  contaNome: "Nubank",
                  cartaoNome: null,
                  categoriaNome: null,
                },
              ],
            },
          ],
        },
      })),
    };

    const result = await consultar_assistente_v2(
      relatorios as unknown as ModuloRelatorios,
      { merchant: "Uber" },
      USER,
    );

    expect(result.ids).toEqual([MOV]);
    expect(result.formattedText.toLowerCase()).toMatch(/uber/);
    expect(relatorios.consultar_visao).toHaveBeenCalled();
  });
});
