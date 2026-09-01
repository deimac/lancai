import { describe, expect, it } from "vitest";
import { score_descricao_conciliacao } from "../servicos/conciliar-manual-com-fonte";
import {
  colapsar_lote_semantico,
  ids_suspeitos_mesmo_minuto,
} from "../servicos/skip-semantico-of";
import type { EventoFinanceiroNormalizado } from "@lancai/tipos";

const CONTA = "87154b0d-8c85-41e3-ae56-6fbeea80c73a";
const WS = "1269cbab-3a7f-40ef-a0d1-40cea00a8b09";
const DESC = "Transferência recebida Pix - PROTECH";

/** Instante UTC que o Extrato mostra como `hh:mm` no dia (relógio da instituição = UTC−6). */
function instante_no_dia(dia: string, hora: string, minuto: string): string {
  const local = Date.parse(`${dia}T${hora}:${minuto}:00.000Z`);
  return new Date(local + 6 * 60 * 60 * 1000).toISOString();
}

function evento(
  parcial: Partial<EventoFinanceiroNormalizado> & Pick<EventoFinanceiroNormalizado, "idExterno">,
): EventoFinanceiroNormalizado {
  return {
    workspaceId: WS,
    fonte: "open_finance",
    provedor: "pluggy",
    ocorridoEm: "2026-08-30",
    valor: 15_000,
    tipo: "receita",
    descricaoFonte: DESC,
    contaId: CONTA,
    statusFonte: "confirmado",
    fatoImutavel: true,
    ...parcial,
  };
}

describe("score semântico para reatachar", () => {
  it("reconhece a mesma descrição do banco", () => {
    const score = score_descricao_conciliacao(
      "IFOOD *RESTAURANTE",
      "IFOOD *RESTAURANTE",
      null,
    );
    expect(score).toBeGreaterThanOrEqual(0.7);
  });

  it("não casa descrições distintas", () => {
    const score = score_descricao_conciliacao("PADARIA CENTRAL", "UBER TRIP", null);
    expect(score).toBeLessThan(0.7);
  });
});

describe("colapsar_lote_semantico", () => {
  it("quatro Pix iguais no mesmo dia, minutos diferentes, viram quatro Fatos", () => {
    const { aceitos, pulados, suspeitos } = colapsar_lote_semantico([
      evento({
        idExterno: "a",
        ocorridoEmInstante: instante_no_dia("2026-08-30", "21", "01"),
      }),
      evento({
        idExterno: "b",
        ocorridoEmInstante: instante_no_dia("2026-08-30", "21", "01"),
      }),
      evento({
        idExterno: "c",
        ocorridoEmInstante: instante_no_dia("2026-08-30", "21", "02"),
      }),
      evento({
        idExterno: "d",
        ocorridoEmInstante: instante_no_dia("2026-08-30", "21", "02"),
      }),
    ]);
    expect(pulados).toBe(0);
    expect(aceitos).toHaveLength(4);
    expect(suspeitos.sort()).toEqual(["b", "d"]);
  });

  it("dois no mesmo minuto: dois Fatos e marca o extra", () => {
    const { aceitos, pulados, suspeitos } = colapsar_lote_semantico([
      evento({
        idExterno: "1882caed-f6e7-4f76-852c-e1ccca413120",
        ocorridoEmInstante: instante_no_dia("2026-08-30", "21", "02"),
      }),
      evento({
        idExterno: "4840dd1e-ee2e-41d3-bb12-5fb8af055f11",
        ocorridoEmInstante: instante_no_dia("2026-08-30", "21", "02"),
      }),
    ]);
    expect(pulados).toBe(0);
    expect(aceitos).toHaveLength(2);
    expect(suspeitos).toEqual(["4840dd1e-ee2e-41d3-bb12-5fb8af055f11"]);
  });

  it("sem instante não colapsa e não pergunta", () => {
    const { aceitos, pulados, suspeitos } = colapsar_lote_semantico([
      evento({ idExterno: "a" }),
      evento({ idExterno: "b" }),
    ]);
    expect(pulados).toBe(0);
    expect(aceitos).toHaveLength(2);
    expect(suspeitos).toEqual([]);
  });

  it("mantém duas despesas diferentes no mesmo dia", () => {
    const { aceitos, pulados } = colapsar_lote_semantico([
      evento({ idExterno: "a", descricaoFonte: "PREVER SERVICOS POSTUMOS LTDA", valor: 111.9 }),
      evento({ idExterno: "b", descricaoFonte: "IFOOD *RESTAURANTE", valor: 111.9 }),
    ]);
    expect(pulados).toBe(0);
    expect(aceitos).toHaveLength(2);
  });
});

describe("ids_suspeitos_mesmo_minuto", () => {
  it("o mais antigo fica; o extra é o suspeito", () => {
    const suspeitos = ids_suspeitos_mesmo_minuto([
      {
        id: "novo",
        contaId: CONTA,
        tipo: "receita",
        valor: 15_000,
        data: "2026-08-30",
        descricaoFonte: DESC,
        ocorridoEmInstante: instante_no_dia("2026-08-30", "21", "02"),
        dataCriacao: "2026-08-31T00:10:00.000Z",
      },
      {
        id: "velho",
        contaId: CONTA,
        tipo: "receita",
        valor: 15_000,
        data: "2026-08-30",
        descricaoFonte: DESC,
        ocorridoEmInstante: instante_no_dia("2026-08-30", "21", "02"),
        dataCriacao: "2026-08-30T21:02:00.000Z",
      },
    ]);
    expect(suspeitos).toEqual(["novo"]);
  });
});
