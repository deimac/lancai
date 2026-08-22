import { describe, expect, it } from "vitest";
import {
  competencia_vencimento_proximo,
  data_proxima_do_vencimento,
  descricao_parece_pagamento_fatura,
  intervalo_ciclo_fatura,
  competencia_ciclo_da_data,
  linha_aceita_pagamento_fatura,
  sugerir_pagamento_fatura,
  valores_proximos,
  type CartaoSugestaoFatura,
  type MovimentoSugestaoFatura,
} from "../pagamento-fatura";

const cartao: CartaoSugestaoFatura = {
  id: "cartao-itau",
  nome: "Itaú Azul",
  contaId: "conta-pj",
  vencimento: 17,
  fechamento: 10,
};

function mov(parcial: Partial<MovimentoSugestaoFatura> & Pick<MovimentoSugestaoFatura, "id">): MovimentoSugestaoFatura {
  return {
    descricao: "Padaria",
    descricaoFonte: "PADARIA",
    valor: "32.50",
    tipo: "despesa",
    dataMovimento: "2026-08-10",
    contaId: "conta-pj",
    cartaoId: null,
    papel: "gasto",
    ...parcial,
  };
}

describe("heurística de pagamento de fatura", () => {
  it("reconhece descrição de fatura e ignora Pix/boleto genérico", () => {
    expect(descricao_parece_pagamento_fatura("PAGTO FATURA ITAU")).toBe(true);
    expect(descricao_parece_pagamento_fatura("pagamento do cartão C6")).toBe(true);
    expect(descricao_parece_pagamento_fatura("Fatura C6")).toBe(true);
    expect(descricao_parece_pagamento_fatura("UBER TRIP")).toBe(false);
    expect(descricao_parece_pagamento_fatura("Pagamento de conta COPEL-DIS")).toBe(false);
    expect(descricao_parece_pagamento_fatura("Pagamento com QR Pix MUNICIPIO")).toBe(false);
    expect(descricao_parece_pagamento_fatura("Pagamento PIX")).toBe(false);
    expect(descricao_parece_pagamento_fatura("Pagamento recebido")).toBe(false);
  });

  it("só oferece o check em débito de conta ou crédito no cartão", () => {
    expect(
      linha_aceita_pagamento_fatura({ tipo: "despesa", contaId: "c", cartaoId: null }),
    ).toBe(true);
    expect(
      linha_aceita_pagamento_fatura({ tipo: "receita", contaId: null, cartaoId: "k" }),
    ).toBe(true);
    expect(
      linha_aceita_pagamento_fatura({ tipo: "despesa", contaId: null, cartaoId: "k" }),
    ).toBe(false);
  });

  it("escolhe a competência do vencimento mais próximo", () => {
    expect(competencia_vencimento_proximo("2026-08-16", 17)).toBe("2026-08");
    expect(competencia_vencimento_proximo("2026-08-01", 17)).toBe("2026-07");
  });

  it("monta o ciclo até o fechamento do mês da competência", () => {
    expect(intervalo_ciclo_fatura("2026-08", 10)).toEqual({
      inicio: "2026-07-11",
      fim: "2026-08-10",
    });
  });

  it("acha a competência da fatura a partir da data da compra", () => {
    expect(competencia_ciclo_da_data("2026-08-01", 10)).toBe("2026-08");
    expect(competencia_ciclo_da_data("2026-08-10", 10)).toBe("2026-08");
    expect(competencia_ciclo_da_data("2026-08-11", 10)).toBe("2026-09");
    expect(competencia_ciclo_da_data("2026-07-11", 10)).toBe("2026-08");
  });

  it("sugere pela descrição na conta preferencial, sem aplicar sozinha", () => {
    const sugestao = sugerir_pagamento_fatura(
      mov({
        id: "pix",
        descricao: "Fatura Itaú",
        descricaoFonte: "PAGTO FATURA CARTAO ITAU",
        valor: "1200.00",
        dataMovimento: "2026-08-17",
      }),
      [cartao],
      [],
    );
    expect(sugestao).toEqual({
      cartaoId: "cartao-itau",
      cartaoNome: "Itaú Azul",
      competencia: "2026-08",
      motivo: "descricao",
    });
  });

  it("sugere quando o valor casa com a soma do ciclo e a data está perto do vencimento", () => {
    const compras: MovimentoSugestaoFatura[] = [
      mov({
        id: "c1",
        cartaoId: "cartao-itau",
        contaId: null,
        valor: "800.00",
        dataMovimento: "2026-07-20",
      }),
      mov({
        id: "c2",
        cartaoId: "cartao-itau",
        contaId: null,
        valor: "400.50",
        dataMovimento: "2026-08-09",
      }),
    ];
    const sugestao = sugerir_pagamento_fatura(
      mov({
        id: "pix",
        descricao: "Pix enviado",
        descricaoFonte: "PIX ENVIADO",
        valor: "1200.50",
        dataMovimento: "2026-08-17",
      }),
      [cartao],
      compras,
    );
    expect(sugestao?.motivo).toBe("valor_ciclo");
    expect(sugestao?.cartaoId).toBe("cartao-itau");
  });

  it("prefere o cartão cujo nome aparece na descrição", () => {
    const c6: CartaoSugestaoFatura = {
      id: "cartao-c6",
      nome: "C6",
      vencimento: 10,
    };
    const sugestao = sugerir_pagamento_fatura(
      mov({
        id: "pix",
        descricao: "Fatura C6",
        descricaoFonte: "PAGTO FATURA C6",
        valor: "200.00",
        dataMovimento: "2026-08-10",
      }),
      [cartao, c6],
      [],
    );
    expect(sugestao?.cartaoId).toBe("cartao-c6");
    expect(sugestao?.motivo).toBe("descricao");
  });

  it("não sugere boleto/Pix só porque a fonte tem a palavra pagamento", () => {
    expect(
      sugerir_pagamento_fatura(
        mov({
          id: "boleto",
          descricao: "COPEL-DIS",
          descricaoFonte: "Pagamento de conta COPEL-DIS",
          valor: "180.00",
          dataMovimento: "2026-08-17",
        }),
        [cartao],
        [],
      ),
    ).toBeNull();
  });

  it("não sugere compra comum longe do vencimento", () => {
    expect(
      sugerir_pagamento_fatura(
        mov({ id: "padaria", dataMovimento: "2026-08-03" }),
        [cartao],
        [],
      ),
    ).toBeNull();
  });

  it("emparelha crédito no cartão com débito já marcado no mês", () => {
    const sugestao = sugerir_pagamento_fatura(
      mov({
        id: "credito",
        tipo: "receita",
        cartaoId: "cartao-itau",
        contaId: null,
        valor: "1200.00",
        dataMovimento: "2026-08-17",
        descricao: "Pagamento recebido",
        descricaoFonte: "PAYMENT",
      }),
      [cartao],
      [
        mov({
          id: "debito",
          valor: "1200.00",
          dataMovimento: "2026-08-17",
          papel: "pagamento_fatura",
          competenciaFatura: "2026-08",
        }),
      ],
    );
    expect(sugestao?.motivo).toBe("par_credito");
  });

  it("valores_proximos tolera R$ 1", () => {
    expect(valores_proximos(100, 100.4)).toBe(true);
    expect(valores_proximos(100, 102)).toBe(false);
    expect(data_proxima_do_vencimento("2026-08-17", 17)).toBe(true);
    expect(data_proxima_do_vencimento("2026-08-01", 17)).toBe(false);
  });
});
