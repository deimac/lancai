import { describe, expect, it, vi } from "vitest";
import { Memoria, RepositorioMemoriaEmMemoria } from "@lancai/conhecimento";
import {
  montar_texto_resumo_baixa_confianca,
  enviar_resumos_baixa_confianca,
  type UsuarioComRevisao,
} from "../servicos/resumo-baixa-confianca";

const filaAna: UsuarioComRevisao = {
  usuarioId: "11111111-1111-1111-1111-111111111111",
  nome: "Ana",
  whatsappNumero: "5511999999999",
  itens: [
    {
      id: "a",
      descricao: "iFood",
      valor: "10.00",
      dataMovimento: "2026-08-07",
      categoriaNome: "Não classificado",
      classificadoPor: "usuario",
      confiancaIa: null,
    },
  ],
};

describe("montar_texto_resumo_baixa_confianca", () => {
  it("lista itens com motivo e CTA", () => {
    const texto = montar_texto_resumo_baixa_confianca("Maria Silva", [
      {
        id: "1",
        descricao: "iFood",
        valor: "45.00",
        dataMovimento: "2026-08-07",
        categoriaNome: "Não classificado",
        classificadoPor: "ia",
        confiancaIa: null,
      },
      {
        id: "2",
        descricao: "Uber",
        valor: "22.50",
        dataMovimento: "2026-08-06",
        categoriaNome: "Transporte",
        classificadoPor: "ia",
        confiancaIa: 0.55,
      },
    ]);

    expect(texto).toContain("Maria, você tem 2 lançamentos para revisar:");
    expect(texto).toContain("1. iFood ·");
    expect(texto).toContain("sem categoria");
    expect(texto).toContain("IA 55%");
    expect(texto).toContain("Extrato → Revisar");
  });
});

describe("enviar_resumos_baixa_confianca", () => {
  it("pula usuário já notificado no dia", async () => {
    const memoria = new Memoria(new RepositorioMemoriaEmMemoria());
    await memoria.salvar_habito(filaAna.usuarioId, "resumo_baixa_confianca_dia", "2026-08-08");
    const enviar = vi.fn();

    const resultado = await enviar_resumos_baixa_confianca({
      dia: "2026-08-08",
      memoria,
      enviar,
      filas: [filaAna],
    });

    expect(resultado.puladosIdempotencia).toBe(1);
    expect(resultado.enviados).toBe(0);
    expect(enviar).not.toHaveBeenCalled();
  });

  it("envia, grava hábito e idempotência na segunda chamada", async () => {
    const memoria = new Memoria(new RepositorioMemoriaEmMemoria());
    const enviar = vi.fn().mockResolvedValue(undefined);

    const primeiro = await enviar_resumos_baixa_confianca({
      dia: "2026-08-08",
      memoria,
      enviar,
      filas: [filaAna],
    });
    expect(primeiro.enviados).toBe(1);
    expect(enviar).toHaveBeenCalledOnce();
    expect(enviar.mock.calls[0]?.[0]?.numero).toBe("5511999999999");
    expect(enviar.mock.calls[0]?.[0]?.texto).toContain("Ana, você tem 1 lançamento");

    const segundo = await enviar_resumos_baixa_confianca({
      dia: "2026-08-08",
      memoria,
      enviar,
      filas: [filaAna],
    });
    expect(segundo.puladosIdempotencia).toBe(1);
    expect(segundo.enviados).toBe(0);
    expect(enviar).toHaveBeenCalledOnce();
  });

  it("dryRun não envia nem grava hábito", async () => {
    const memoria = new Memoria(new RepositorioMemoriaEmMemoria());
    const enviar = vi.fn();

    const resultado = await enviar_resumos_baixa_confianca({
      dia: "2026-08-08",
      dryRun: true,
      memoria,
      enviar,
      filas: [filaAna],
    });

    expect(resultado.detalhes[0]?.status).toBe("dry_run");
    expect(enviar).not.toHaveBeenCalled();
    expect(await memoria.buscar_habito(filaAna.usuarioId, "resumo_baixa_confianca_dia")).toBeUndefined();
  });
});
