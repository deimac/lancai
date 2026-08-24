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

  it("pedido de entradas não cita despesa zerada no resumo", async () => {
    const relatorios = {
      consultar_visao: vi.fn(async () => ({
        tipo: "historico" as const,
        dados: {
          periodo: { de: "2026-08-01", ate: "2026-08-31" },
          totalReceitas: 78511.16,
          totalDespesas: 0,
          saldoPeriodo: 78511.16,
          totalItens: 16,
          itensOmitidos: 0,
          deslocamento: 0,
          dias: [],
        },
      })),
    };

    const result = await consultar_assistente_v2(
      relatorios as unknown as ModuloRelatorios,
      { tipos: ["receita"], aggregation: "sum" },
      USER,
    );

    expect(result.formattedText).toMatch(/você recebeu/i);
    expect(result.formattedText).not.toMatch(/despesas/i);
    expect(result.formattedText).not.toMatch(/saldo/i);
  });

  it("visão fluxo descreve gasto pessoal com dinheiro da empresa", async () => {
    const relatorios = {
      consultar_visao: vi.fn(async () => ({
        tipo: "fluxo" as const,
        dados: {
          periodo: { de: "2026-08-01", ate: "2026-08-31" },
          totalPessoalComEmpresa: 320,
          totalEmpresaComPessoal: 0,
          itens: [
            {
              descricao: "Almoço",
              valor: 320,
              data: "2026-08-10",
              direcao: "pessoal_com_empresa" as const,
            },
          ],
        },
      })),
    };

    const result = await consultar_assistente_v2(
      relatorios as unknown as ModuloRelatorios,
      { visionType: "fluxo", aggregation: "sum" },
      USER,
    );

    expect(relatorios.consultar_visao).toHaveBeenCalledWith(
      "fluxo",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(result.formattedText).toMatch(/pessoal usando dinheiro da empresa/i);
    expect(result.formattedText).not.toMatch(/70\.670/);
  });
});
