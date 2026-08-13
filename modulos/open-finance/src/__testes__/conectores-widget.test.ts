import { describe, expect, it } from "vitest";
import { eh_conector_meu_pluggy, ids_conectores_para_widget } from "../pluggy/conectores-widget";

describe("conectores do widget", () => {
  it("reconhece Meu Pluggy pelo id e pelo nome", () => {
    expect(eh_conector_meu_pluggy({ id: 200, name: "Outro" })).toBe(true);
    expect(eh_conector_meu_pluggy({ id: 1, name: "MeuPluggy" })).toBe(true);
    expect(eh_conector_meu_pluggy({ id: 601, name: "Itaú" })).toBe(false);
  });

  it("não inclui Meu Pluggy nos ids do Connect", () => {
    expect(
      ids_conectores_para_widget([
        { id: 601, name: "Itaú" },
        { id: 200, name: "MeuPluggy" },
        { id: 612, name: "Nubank" },
      ]),
    ).toEqual([601, 612]);
  });
});
