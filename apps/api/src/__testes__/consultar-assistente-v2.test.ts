import { describe, expect, it, vi } from "vitest";
import type { ModuloRelatorios } from "@lancai/relatorios";
import { resolver_periodo_spec } from "@lancai/ia";
import { formatarMoeda, hojeISO } from "@lancai/tipos";
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

    expect(result.formattedText).toMatch(/você teve/i);
    expect(result.formattedText).toMatch(/entradas/i);
    expect(result.formattedText).not.toMatch(/despesas/i);
    expect(result.formattedText).not.toMatch(/saldo/i);
    expect(result.formattedText).not.toMatch(/detalhado/i);
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
              id: "00000000-0000-4000-8000-000000000301",
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
    expect(result.ids).toEqual(["00000000-0000-4000-8000-000000000301"]);
    expect(result.formattedText).not.toMatch(/70\.670/);
  });

  it("resolve mes_passado para o intervalo do mês anterior", async () => {
    const relatorios = {
      consultar_visao: vi.fn(async () => ({
        tipo: "historico" as const,
        dados: {
          periodo: { de: "2026-07-01", ate: "2026-07-31" },
          totalReceitas: 0,
          totalDespesas: 10,
          saldoPeriodo: -10,
          totalItens: 0,
          itensOmitidos: 0,
          deslocamento: 0,
          dias: [],
        },
      })),
    };

    await consultar_assistente_v2(
      relatorios as unknown as ModuloRelatorios,
      { period: { tipo: "mes_passado" }, aggregation: "sum", tipos: ["despesa"] },
      USER,
    );

    const periodo = resolver_periodo_spec({ tipo: "mes_passado" }, hojeISO());
    expect(relatorios.consultar_visao).toHaveBeenCalledWith(
      "historico",
      expect.objectContaining({ periodo }),
      expect.anything(),
      expect.anything(),
    );
  });

  it("maior entrada não soma o dia: grain top com limite 1", async () => {
    const relatorios = {
      consultar_visao: vi.fn(async () => ({
        tipo: "historico" as const,
        dados: {
          periodo: { de: "2026-08-24", ate: "2026-08-24" },
          totalReceitas: 4734.05,
          totalDespesas: 0,
          saldoPeriodo: 4734.05,
          totalItens: 2,
          itensOmitidos: 1,
          deslocamento: 0,
          dias: [
            {
              data: "2026-08-24",
              itens: [
                {
                  id: MOV,
                  descricao: "PIX CLIENTE",
                  tipo: "receita",
                  valor: 7453,
                  perfil: "pj" as const,
                  contaNome: "Mercado Pago",
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
      {
        tipos: ["receita"],
        aggregation: "max",
        period: { tipo: "personalizado", de: "2026-08-24", ate: "2026-08-24" },
      },
      USER,
    );

    expect(relatorios.consultar_visao).toHaveBeenCalledWith(
      "historico",
      expect.objectContaining({ tipos: ["receita"] }),
      expect.anything(),
      expect.objectContaining({ limite: 1, ordenacao: { by: "valor", dir: "desc" } }),
    );
    expect(result.formattedText).toMatch(/maior entrada/i);
    expect(result.formattedText).toMatch(/pix cliente/i);
    expect(result.formattedText).not.toMatch(/você teve/i);
    expect(result.formattedText).not.toMatch(/você recebeu/i);
  });

  it("lista com limit 3 recorta sem somar o dia", async () => {
    const relatorios = {
      consultar_visao: vi.fn(async () => ({
        tipo: "historico" as const,
        dados: {
          periodo: { de: "2026-08-24", ate: "2026-08-24" },
          totalReceitas: 8000,
          totalDespesas: 120,
          saldoPeriodo: 7880,
          totalItens: 10,
          itensOmitidos: 7,
          deslocamento: 0,
          dias: [
            {
              data: "2026-08-24",
              itens: [
                {
                  id: MOV,
                  descricao: "Pix",
                  tipo: "receita",
                  valor: 500,
                  perfil: "pj" as const,
                  contaNome: "Mercado Pago",
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
      {
        visionType: "historico",
        limit: 3,
        orderBy: "data",
        orderDir: "desc",
        period: { tipo: "personalizado", de: "2026-08-24", ate: "2026-08-24" },
      },
      USER,
    );

    expect(relatorios.consultar_visao).toHaveBeenCalledWith(
      "historico",
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ limite: 3, ordenacao: { by: "data", dir: "desc" } }),
    );
    expect(result.formattedText).toMatch(/últimos 1 lançamentos/i);
    expect(result.formattedText).not.toMatch(/você (recebeu|gastou)/i);
  });

  it("resultado do período soma receitas menos despesas", async () => {
    const relatorios = {
      consultar_visao: vi.fn(async () => ({
        tipo: "historico" as const,
        dados: {
          periodo: { de: "2026-08-24", ate: "2026-08-24" },
          totalReceitas: 8000,
          totalDespesas: 120,
          saldoPeriodo: 7880,
          totalItens: 4,
          itensOmitidos: 0,
          deslocamento: 0,
          dias: [],
        },
      })),
    };

    const result = await consultar_assistente_v2(
      relatorios as unknown as ModuloRelatorios,
      { aggregation: "sum", period: { tipo: "personalizado", de: "2026-08-24", ate: "2026-08-24" } },
      USER,
    );

    expect(result.formattedText).toMatch(/entradas/i);
    expect(result.formattedText).toMatch(/saídas/i);
    expect(result.formattedText).toMatch(/resultado/i);
    expect(result.formattedText).toContain(formatarMoeda(7880));
    expect(result.formattedText).not.toMatch(/detalhado/i);
  });

  it("histórico vazio de saídas menciona as entradas do mesmo dia", async () => {
    const relatorios = {
      consultar_visao: vi.fn(async (visao: string, filtros: { tipos?: string[] }) => {
        if (filtros.tipos?.includes("despesa")) {
          return {
            tipo: "historico" as const,
            dados: {
              periodo: { de: "2026-08-25", ate: "2026-08-25" },
              totalReceitas: 0,
              totalDespesas: 0,
              saldoPeriodo: 0,
              totalItens: 0,
              itensOmitidos: 0,
              deslocamento: 0,
              dias: [],
            },
          };
        }
        return {
          tipo: "historico" as const,
          dados: {
            periodo: { de: "2026-08-25", ate: "2026-08-25" },
            totalReceitas: 100,
            totalDespesas: 0,
            saldoPeriodo: 100,
            totalItens: 3,
            itensOmitidos: 0,
            deslocamento: 0,
            dias: [
              {
                data: "2026-08-25",
                itens: [
                  {
                    id: MOV,
                    descricao: "Pix",
                    tipo: "receita" as const,
                    valor: 50,
                    perfil: "pj" as const,
                    contaNome: "Mercado Pago",
                    cartaoNome: null,
                    categoriaNome: null,
                  },
                  {
                    id: "00000000-0000-4000-8000-000000000102",
                    descricao: "Pix 2",
                    tipo: "receita" as const,
                    valor: 30,
                    perfil: "pj" as const,
                    contaNome: "Mercado Pago",
                    cartaoNome: null,
                    categoriaNome: null,
                  },
                  {
                    id: "00000000-0000-4000-8000-000000000103",
                    descricao: "Pix 3",
                    tipo: "receita" as const,
                    valor: 20,
                    perfil: "pj" as const,
                    contaNome: "Mercado Pago",
                    cartaoNome: null,
                    categoriaNome: null,
                  },
                ],
              },
            ],
          },
        };
      }),
    };

    const result = await consultar_assistente_v2(
      relatorios as unknown as ModuloRelatorios,
      {
        tipos: ["despesa"],
        aggregation: "sum",
        period: { tipo: "personalizado", de: "2026-08-25", ate: "2026-08-25" },
      },
      USER,
      { dataAtual: "2026-08-25" },
    );

    expect(relatorios.consultar_visao).toHaveBeenCalledTimes(2);
    expect(result.formattedText).toMatch(/não houve saídas/i);
    expect(result.formattedText).toContain("3 entradas");
  });
});
