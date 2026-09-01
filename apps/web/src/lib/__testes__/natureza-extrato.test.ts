import { describe, expect, it } from "vitest";
import {
  natureza_do_movimento,
  pode_excluir_movimento,
  rotulo_natureza,
  status_visual_movimento,
} from "../natureza-extrato";
import type { MovimentoResumo } from "../api";

function base(parcial: Partial<MovimentoResumo> = {}): MovimentoResumo {
  return {
    id: "1",
    descricao: "Padaria",
    descricaoFonte: "PADARIA",
    valor: "32.50",
    tipo: "despesa",
    status: "realizado",
    fonte: "open_finance",
    provedor: "provedor_teste",
    idExterno: null,
    dataMovimento: "2026-08-10",
    contaId: "c1",
    cartaoId: null,
    statusFonte: "posted",
    parcelaNumero: null,
    parcelaTotal: null,
    ignoradoEmRelatorio: false,
    possivelRepetido: false,
    categoriaId: "cat",
    categoriaNome: "Alimentação",
    classificadoPor: "usuario",
    regraId: null,
    regraTrecho: null,
    classificadoEm: null,
    confiancaIa: null,
    tipoGasto: "pf",
    papel: "gasto",
    cartaoFaturaId: null,
    competenciaFatura: null,
    ...parcial,
  };
}

describe("natureza_do_movimento", () => {
  it("marca pagamento de fatura", () => {
    expect(natureza_do_movimento(base({ papel: "pagamento_fatura" }))).toBe("fatura");
    expect(rotulo_natureza(base({ papel: "pagamento_fatura" }))).toBe("Fatura");
  });

  it("mostra parcela n/m", () => {
    const m = base({ parcelaNumero: 2, parcelaTotal: 10 });
    expect(natureza_do_movimento(m)).toBe("parcela");
    expect(rotulo_natureza(m)).toBe("Parcela 2/10");
  });

  it("reconhece recorrência", () => {
    expect(natureza_do_movimento(base({ fonte: "recorrencia" }))).toBe("recorrente");
  });

  it("não deixa excluir Open Finance", () => {
    expect(pode_excluir_movimento("open_finance")).toBe(false);
    expect(pode_excluir_movimento("manual")).toBe(true);
    expect(pode_excluir_movimento("pdf")).toBe(true);
  });

  it("marca previsto vencido", () => {
    expect(status_visual_movimento(base({ status: "previsto", dataMovimento: "2026-08-01" }), "2026-08-10")).toBe(
      "vencida",
    );
  });
});
