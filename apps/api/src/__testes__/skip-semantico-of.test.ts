import { describe, expect, it } from "vitest";
import { score_descricao_conciliacao } from "../servicos/conciliar-manual-com-fonte";
import { colapsar_lote_semantico } from "../servicos/skip-semantico-of";
import type { EventoFinanceiroNormalizado } from "@lancai/tipos";

const CONTA = "87154b0d-8c85-41e3-ae56-6fbeea80c73a";
const WS = "1269cbab-3a7f-40ef-a0d1-40cea00a8b09";

function evento(
  parcial: Partial<EventoFinanceiroNormalizado> & Pick<EventoFinanceiroNormalizado, "idExterno">,
): EventoFinanceiroNormalizado {
  return {
    workspaceId: WS,
    fonte: "open_finance",
    provedor: "pluggy",
    ocorridoEm: "2025-08-14",
    valor: 111.9,
    tipo: "despesa",
    descricaoFonte: "Pagamento com QR Pix PREVER SERVICOS POSTUMOS LTDA",
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
  it("dois IDs Pluggy do mesmo Pix viram um Fato", () => {
    const { aceitos, pulados } = colapsar_lote_semantico([
      evento({ idExterno: "1882caed-f6e7-4f76-852c-e1ccca413120" }),
      evento({ idExterno: "4840dd1e-ee2e-41d3-bb12-5fb8af055f11" }),
    ]);
    expect(pulados).toBe(1);
    expect(aceitos).toHaveLength(1);
    expect(aceitos[0]?.idExterno).toBe("1882caed-f6e7-4f76-852c-e1ccca413120");
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
