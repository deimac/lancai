import { describe, expect, it } from "vitest";
import { score_descricao_conciliacao } from "../servicos/conciliar-manual-com-fonte";

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
