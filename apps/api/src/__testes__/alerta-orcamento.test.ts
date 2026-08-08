import { describe, expect, it } from "vitest";
import { Memoria, RepositorioMemoriaEmMemoria } from "@lancai/conhecimento";
import {
  filtrar_alertas_ainda_nao_enviados,
  chave_habito_alerta_orcamento,
} from "../servicos/alerta-orcamento-open-finance";
import { alertas_de_status_orcamento, type StatusOrcamento } from "../servicos/orcamento-servico";

function status(parcial: {
  id: string;
  percentual: number;
  categoriaNome?: string | null;
  limite?: number;
  gasto?: number;
}): StatusOrcamento {
  return {
    orcamento: {
      id: parcial.id,
      usuarioId: "u1",
      workspaceId: "w1",
      categoriaId: parcial.categoriaNome ? "c1" : null,
      valorLimite: String(parcial.limite ?? 1000),
      recorrenteMensal: true,
      mesReferencia: null,
      ativo: true,
      dataCriacao: new Date(),
      dataAtualizacao: new Date(),
    } as StatusOrcamento["orcamento"],
    categoriaNome: parcial.categoriaNome ?? null,
    gasto: parcial.gasto ?? (parcial.percentual / 100) * (parcial.limite ?? 1000),
    limite: parcial.limite ?? 1000,
    percentual: parcial.percentual,
  };
}

describe("alertas_de_status_orcamento", () => {
  it("emite 80% e 100% com textos distintos", () => {
    const alertas = alertas_de_status_orcamento([
      status({ id: "o1", percentual: 85, categoriaNome: "Alimentação" }),
      status({ id: "o2", percentual: 110, categoriaNome: null }),
      status({ id: "o3", percentual: 40, categoriaNome: "Lazer" }),
    ]);

    expect(alertas).toHaveLength(2);
    expect(alertas[0]).toMatchObject({ orcamentoId: "o1", faixa: 80 });
    expect(alertas[0]?.texto).toContain("Alimentação");
    expect(alertas[1]).toMatchObject({ orcamentoId: "o2", faixa: 100 });
    expect(alertas[1]?.texto).toContain("estourado");
  });
});

describe("filtrar_alertas_ainda_nao_enviados", () => {
  it("pula faixa já enviada e deixa subir para 100%", async () => {
    const memoria = new Memoria(new RepositorioMemoriaEmMemoria());
    const usuarioId = "11111111-1111-1111-1111-111111111111";
    const orcamentoId = "22222222-2222-2222-2222-222222222222";
    await memoria.salvar_habito(
      usuarioId,
      chave_habito_alerta_orcamento(orcamentoId, "2026-08"),
      "80",
    );

    const filtrados = await filtrar_alertas_ainda_nao_enviados(
      usuarioId,
      "2026-08",
      [
        { orcamentoId, faixa: 80, texto: "80%" },
        { orcamentoId, faixa: 100, texto: "100%" },
      ],
      memoria,
    );

    expect(filtrados).toEqual([{ orcamentoId, faixa: 100, texto: "100%" }]);
  });
});
