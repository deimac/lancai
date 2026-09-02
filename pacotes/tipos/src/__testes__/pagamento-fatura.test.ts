import { describe, expect, it } from "vitest";
import {
  competencia_vencimento_proximo,
  data_proxima_do_vencimento,
  descricao_parece_pagamento_fatura,
  eh_credito_quitacao_no_cartao,
  intervalo_ciclo_fatura,
  ciclo_aberto_em,
  ciclo_do_movimento,
  competencia_ciclo_da_data,
  competencia_alvo_do_modo_fatura,
  competencia_ciclo_vencendo_em,
  competencia_quitacao_fatura,
  competencia_vencimento_da_quitacao,
  conhecimento_inicial_credito_quitacao,
  data_vencimento_do_ciclo,
  dia_fechamento_no_mes,
  linha_aceita_pagamento_fatura,
  mapa_fechamento_cartoes,
  mapa_vencimento_cartoes,
  mes_resultado_do_movimento,
  movimento_no_resultado_do_mes,
  eh_linha_da_fatura,
  aplicar_total_oficial,
  na_fatura_do_recorte,
  soma_cobrada_do_vencimento,
  pagamentos_ciclo_de,
  valor_na_fatura,
  periodo_amplo_do_ciclo,
  selo_fatura_ciclo,
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
    expect(eh_credito_quitacao_no_cartao("Pagamento recebido")).toBe(true);
    expect(eh_credito_quitacao_no_cartao("Pagamento PIX")).toBe(true);
    expect(eh_credito_quitacao_no_cartao("Pagamento com QR Pix ITAU")).toBe(false);
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
    expect(intervalo_ciclo_fatura("2026-08", 30)).toEqual({
      inicio: "2026-07-31",
      fim: "2026-08-30",
    });
    expect(dia_fechamento_no_mes(2026, 2, 30)).toBe(28);
    expect(competencia_ciclo_da_data("2026-02-28", 30)).toBe("2026-02");
    expect(competencia_ciclo_da_data("2026-03-01", 30)).toBe("2026-03");
  });

  it("acha a competência da fatura a partir da data da compra", () => {
    expect(competencia_ciclo_da_data("2026-08-01", 10)).toBe("2026-08");
    expect(competencia_ciclo_da_data("2026-08-10", 10)).toBe("2026-08");
    expect(competencia_ciclo_da_data("2026-08-11", 10)).toBe("2026-09");
    expect(competencia_ciclo_da_data("2026-07-11", 10)).toBe("2026-08");
  });

  it("Mercado Pago fecha 12: compra 25/08 entra na fatura de setembro", () => {
    expect(competencia_ciclo_da_data("2026-08-25", 12)).toBe("2026-09");
    expect(competencia_ciclo_da_data("2026-08-12", 12)).toBe("2026-08");
    expect(competencia_ciclo_da_data("2026-08-13", 12)).toBe("2026-09");
  });

  it("selo só quando a competência da fatura é outro mês", () => {
    expect(
      selo_fatura_ciclo({
        dataMovimento: "2026-08-25",
        cartaoId: "mp",
        fechamento: 12,
        vencimento: 17,
        status: "previsto",
      }),
    ).toEqual({
      rotulo: "Fatura set",
      dica: "Em aberto. Entra na fatura de setembro (vence dia 17).",
    });
    expect(
      selo_fatura_ciclo({
        dataMovimento: "2026-08-18",
        cartaoId: "itau",
        fechamento: 30,
        vencimento: 10,
        status: "previsto",
      }),
    ).toBeNull();
    expect(
      selo_fatura_ciclo({
        dataMovimento: "2026-08-25",
        cartaoId: null,
        fechamento: 12,
        vencimento: 17,
      }),
    ).toBeNull();
  });

  it("Pagamento recebido no cartão não ganha selo de compra do ciclo seguinte", () => {
    expect(
      selo_fatura_ciclo({
        dataMovimento: "2026-08-14",
        cartaoId: "mp",
        fechamento: 12,
        vencimento: 17,
        tipo: "receita",
        papel: "pagamento_fatura",
      }),
    ).toBeNull();
    expect(
      selo_fatura_ciclo({
        dataMovimento: "2026-08-14",
        cartaoId: "mp",
        fechamento: 12,
        vencimento: 17,
        tipo: "receita",
      }),
    ).toBeNull();
  });

  it("P&L do cartão usa o mês da fatura; conta usa o mês civil", () => {
    const cartoes = mapa_fechamento_cartoes([{ id: "mp", fechamento: 12 }]);
    expect(
      movimento_no_resultado_do_mes(
        { dataMovimento: "2026-08-25", cartaoId: "mp" },
        "2026-08",
        cartoes,
      ),
    ).toBe(false);
    expect(
      movimento_no_resultado_do_mes(
        { dataMovimento: "2026-08-25", cartaoId: "mp" },
        "2026-09",
        cartoes,
      ),
    ).toBe(true);
    expect(
      movimento_no_resultado_do_mes(
        { dataMovimento: "2026-08-25", cartaoId: null },
        "2026-08",
        cartoes,
      ),
    ).toBe(true);
    expect(periodo_amplo_do_ciclo({ de: "2026-08-01", ate: "2026-08-31" })).toEqual({
      de: "2026-07-01",
      ate: "2026-09-30",
    });
  });

  it("fecha 30 vence 6: 29 e 30 do mês ainda são o ciclo aberto", () => {
    expect(competencia_ciclo_da_data("2026-08-29", 30)).toBe("2026-08");
    expect(competencia_ciclo_da_data("2026-08-30", 30)).toBe("2026-08");
    expect(competencia_ciclo_da_data("2026-08-31", 30)).toBe("2026-09");
  });

  it("fecha 30 vence 6: parcela prevista em setembro entra na fatura aberta de setembro", () => {
    const extra = { vencimento: 6, parcelaNumero: 3, status: "previsto" as const };
    expect(mes_resultado_do_movimento("2026-09-08", "azul", 30, extra)).toBe("2026-09");
    expect(mes_resultado_do_movimento("2026-09-01", "azul", 30, extra)).toBe("2026-09");
    expect(
      mes_resultado_do_movimento("2026-08-06", "azul", 30, {
        vencimento: 6,
        parcelaNumero: 2,
        status: "realizado",
      }),
    ).toBe("2026-08");
    expect(mes_resultado_do_movimento("2026-10-06", "azul", 30, extra)).toBe("2026-10");
    expect(mes_resultado_do_movimento("2026-08-15", "azul", 30)).toBe("2026-08");

    const fechamento = mapa_fechamento_cartoes([{ id: "azul", fechamento: 30 }]);
    const vencimento = mapa_vencimento_cartoes([{ id: "azul", vencimento: 6 }]);
    expect(
      movimento_no_resultado_do_mes(
        { dataMovimento: "2026-09-08", cartaoId: "azul", parcelaNumero: 8, status: "previsto" },
        "2026-09",
        fechamento,
        vencimento,
      ),
    ).toBe(true);
    expect(
      movimento_no_resultado_do_mes(
        { dataMovimento: "2026-09-08", cartaoId: "azul", parcelaNumero: 8, status: "previsto" },
        "2026-08",
        fechamento,
        vencimento,
      ),
    ).toBe(false);
    expect(
      selo_fatura_ciclo({
        dataMovimento: "2026-09-08",
        cartaoId: "azul",
        fechamento: 30,
        vencimento: 6,
        parcelaNumero: 3,
        status: "previsto",
        tipo: "despesa",
      }),
    ).toBeNull();
  });

  it("fecha 12 vence 17: parcela prevista no vencimento entra na fatura que fechou nesse ciclo", () => {
    expect(
      mes_resultado_do_movimento("2026-08-17", "mp", 12, {
        vencimento: 17,
        parcelaNumero: 2,
        status: "previsto",
      }),
    ).toBe("2026-08");
    expect(mes_resultado_do_movimento("2026-08-25", "mp", 12)).toBe("2026-09");
    expect(
      mes_resultado_do_movimento("2026-09-01", "mp", 12, {
        vencimento: 17,
        parcelaNumero: 2,
        status: "previsto",
      }),
    ).toBe("2026-09");
  });

  it("pagamento antes do fechamento empurra o gasto para o ciclo aberto", () => {
    const pagamentos = [
      {
        cartaoId: "c1",
        dataMovimento: "2026-07-29",
        competenciaFatura: "2026-07",
        papel: "pagamento_fatura" as const,
      },
    ];
    expect(
      mes_resultado_do_movimento("2026-07-29", "c1", 30, { vencimento: 6, pagamentos }),
    ).toBe("2026-08");
    expect(
      mes_resultado_do_movimento("2026-07-20", "c1", 30, { vencimento: 6, pagamentos }),
    ).toBe("2026-07");
    expect(
      mes_resultado_do_movimento("2026-08-15", "c1", 30, { vencimento: 6, pagamentos }),
    ).toBe("2026-08");
  });

  it("Pix perto do vencimento depois do fechamento quita o ciclo anterior, não o aberto", () => {
    expect(competencia_quitacao_fatura("2026-08-05", 30, 6, "2026-08")).toBe("2026-07");
    expect(competencia_quitacao_fatura("2026-07-29", 30, 6, "2026-07")).toBe("2026-07");
    expect(competencia_quitacao_fatura("2026-07-29", 30, 6, "2026-08")).toBe("2026-07");
    expect(competencia_quitacao_fatura("2026-08-10", 10, 17, "2026-08")).toBe("2026-08");
    expect(competencia_quitacao_fatura("2026-08-10", 10, 17, "2026-07")).toBe("2026-07");
    expect(competencia_quitacao_fatura("2026-08-30", 30, 6, "2026-09")).toBe("2026-08");
    expect(competencia_ciclo_vencendo_em("2026-08", 30, 6)).toBe("2026-07");
    expect(competencia_ciclo_vencendo_em("2026-09", 30, 6)).toBe("2026-08");
    expect(competencia_ciclo_vencendo_em("2026-08", 12, 17)).toBe("2026-08");
    expect(competencia_vencimento_da_quitacao("2026-06-01", 30, 6)).toBe("2026-06");
    expect(competencia_vencimento_da_quitacao("2026-07-29", 30, 6)).toBe("2026-08");
    expect(competencia_vencimento_da_quitacao("2026-08-05", 30, 6)).toBe("2026-08");
    expect(competencia_vencimento_da_quitacao("2026-08-10", 10, 17)).toBe("2026-08");
    expect(competencia_alvo_do_modo_fatura({ mes: "2026-06", fechamento: 30, vencimento: 6 })).toBe(
      "2026-05",
    );
    expect(competencia_alvo_do_modo_fatura({ mes: "2026-06", fechamento: 2, vencimento: 10 })).toBe(
      "2026-06",
    );
    expect(
      conhecimento_inicial_credito_quitacao({
        tipo: "receita",
        descricaoFonte: "Pagamento PIX",
        cartaoId: "azul",
        dataMovimento: "2026-06-01",
        fechamento: 30,
        vencimento: 6,
      }),
    ).toEqual({
      papel: "pagamento_fatura",
      cartaoFaturaId: "azul",
      competenciaFatura: "2026-06",
      ignoradoEmRelatorio: true,
    });
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

  it("Azul fecha 30 vence 6: soma o ciclo que vence no mês, não o que fecha", () => {
    const azul: CartaoSugestaoFatura = {
      id: "cartao-azul",
      nome: "Azul Itaú",
      vencimento: 6,
      fechamento: 30,
    };
    const sugestao = sugerir_pagamento_fatura(
      mov({
        id: "pix",
        descricao: "Pix enviado",
        descricaoFonte: "PIX ENVIADO",
        valor: "5632.78",
        dataMovimento: "2026-06-01",
      }),
      [azul],
      [
        mov({
          id: "c1",
          cartaoId: "cartao-azul",
          contaId: null,
          valor: "3000.00",
          dataMovimento: "2026-05-10",
        }),
        mov({
          id: "c2",
          cartaoId: "cartao-azul",
          contaId: null,
          valor: "2632.78",
          dataMovimento: "2026-05-28",
        }),
        mov({
          id: "c3",
          cartaoId: "cartao-azul",
          contaId: null,
          valor: "400.00",
          dataMovimento: "2026-06-15",
        }),
      ],
    );
    expect(sugestao).toEqual({
      cartaoId: "cartao-azul",
      cartaoNome: "Azul Itaú",
      competencia: "2026-06",
      motivo: "valor_ciclo",
    });
  });

  it("crédito Pagamento PIX no cartão sugere o mês do vencimento", () => {
    const azul: CartaoSugestaoFatura = {
      id: "cartao-azul",
      nome: "Azul Itaú",
      vencimento: 6,
      fechamento: 30,
    };
    const sugestao = sugerir_pagamento_fatura(
      mov({
        id: "credito",
        tipo: "receita",
        cartaoId: "cartao-azul",
        contaId: null,
        valor: "5632.78",
        dataMovimento: "2026-06-01",
        descricao: "Pagamento PIX",
        descricaoFonte: "Pagamento PIX",
      }),
      [azul],
      [],
    );
    expect(sugestao).toEqual({
      cartaoId: "cartao-azul",
      cartaoNome: "Azul Itaú",
      competencia: "2026-06",
      motivo: "descricao",
    });
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

describe("contrato único de ciclo", () => {
  const parcela = { parcelaNumero: 2, status: "previsto" as const };

  it("fecha 30 vence 6: aberto até o fecha; parcela de setembro fica em setembro", () => {
    expect(ciclo_aberto_em("2026-08-29", 30)).toBe("2026-08");
    expect(ciclo_aberto_em("2026-08-30", 30)).toBe("2026-08");
    expect(ciclo_aberto_em("2026-08-31", 30)).toBe("2026-09");
    expect(data_vencimento_do_ciclo("2026-08", 30, 6)).toBe("2026-09-06");
    expect(ciclo_do_movimento("2026-09-08", "c30", 30, { vencimento: 6, ...parcela })).toBe("2026-09");
    expect(ciclo_do_movimento("2026-10-06", "c30", 30, { vencimento: 6, ...parcela })).toBe("2026-10");
    expect(competencia_quitacao_fatura("2026-08-05", 30, 6)).toBe("2026-07");
    expect(competencia_quitacao_fatura("2026-08-30", 30, 6, "2026-09")).toBe("2026-08");
    expect(data_vencimento_do_ciclo("2026-07", 30, 6)).toBe("2026-08-06");
  });

  it("fecha 12 vence 17: 29/08 já é o ciclo seguinte; dia 1 não é vencimento", () => {
    expect(ciclo_aberto_em("2026-08-29", 12)).toBe("2026-09");
    expect(ciclo_do_movimento("2026-08-25", "c12", 12)).toBe("2026-09");
    expect(ciclo_do_movimento("2026-09-01", "c12", 12, { vencimento: 17, ...parcela })).toBe("2026-09");
    expect(ciclo_do_movimento("2026-08-17", "c12", 12, { vencimento: 17, ...parcela })).toBe("2026-08");
    expect(data_vencimento_do_ciclo("2026-08", 12, 17)).toBe("2026-08-17");
    expect(data_vencimento_do_ciclo("2026-09", 12, 17)).toBe("2026-09-17");
  });

  it("fecha 25 vence 3: mesmo desenho vence no mês seguinte", () => {
    expect(intervalo_ciclo_fatura("2026-08", 25)).toEqual({
      inicio: "2026-07-26",
      fim: "2026-08-25",
    });
    expect(data_vencimento_do_ciclo("2026-08", 25, 3)).toBe("2026-09-03");
    expect(ciclo_aberto_em("2026-08-25", 25)).toBe("2026-08");
    expect(ciclo_aberto_em("2026-08-29", 25)).toBe("2026-09");
    expect(ciclo_do_movimento("2026-08-20", "c25", 25)).toBe("2026-08");
    expect(ciclo_do_movimento("2026-08-26", "c25", 25)).toBe("2026-09");
    expect(ciclo_do_movimento("2026-09-03", "c25", 25, { vencimento: 3, ...parcela })).toBe("2026-09");
    expect(ciclo_do_movimento("2026-10-03", "c25", 25, { vencimento: 3, ...parcela })).toBe("2026-10");
  });

  it("fecha 30 em fevereiro usa o último dia do mês", () => {
    expect(dia_fechamento_no_mes(2026, 2, 30)).toBe(28);
    expect(dia_fechamento_no_mes(2028, 2, 30)).toBe(29);
    expect(intervalo_ciclo_fatura("2026-02", 30)).toEqual({
      inicio: "2026-01-31",
      fim: "2026-02-28",
    });
    expect(intervalo_ciclo_fatura("2028-02", 30)).toEqual({
      inicio: "2028-01-31",
      fim: "2028-02-29",
    });
    expect(ciclo_aberto_em("2026-02-28", 30)).toBe("2026-02");
    expect(ciclo_aberto_em("2026-03-01", 30)).toBe("2026-03");
  });

  it("antecipação no dia anterior ao fecha empurra; residual depois não paga o aberto", () => {
    const antecipado = [
      { cartaoId: "c30", dataMovimento: "2026-07-29", papel: "pagamento_fatura" as const },
    ];
    expect(
      ciclo_do_movimento("2026-07-29", "c30", 30, { vencimento: 6, pagamentos: antecipado }),
    ).toBe("2026-08");
    expect(
      ciclo_do_movimento("2026-07-20", "c30", 30, { vencimento: 6, pagamentos: antecipado }),
    ).toBe("2026-07");

    const residual = [
      { cartaoId: "c30", dataMovimento: "2026-08-05", papel: "pagamento_fatura" as const },
    ];
    expect(competencia_quitacao_fatura("2026-08-05", 30, 6)).toBe("2026-07");
    expect(
      ciclo_do_movimento("2026-08-15", "c30", 30, { vencimento: 6, pagamentos: residual }),
    ).toBe("2026-08");
    expect(
      ciclo_do_movimento("2026-08-31", "c30", 30, { vencimento: 6, pagamentos: residual }),
    ).toBe("2026-09");
  });
});

describe("na_fatura_do_recorte", () => {
  const itau = { id: "itau", fechamento: 30, vencimento: 6 };
  const nu = { id: "nu", fechamento: 2, vencimento: 10 };
  const revolut = { id: "revolut", fechamento: 9, vencimento: 15 };
  const hoje = "2026-08-31";
  const mes = "2026-08";

  it("em 31/08 o ciclo aberto do Itaú já é setembro: parcelas e compra pós-fecha entram; a quitação não", () => {
    const movimentos = [
      {
        dataMovimento: "2026-08-20",
        cartaoId: nu.id,
        tipo: "despesa",
        valor: "4220.10",
        papel: "gasto",
      },
      {
        dataMovimento: "2026-08-15",
        cartaoId: revolut.id,
        tipo: "despesa",
        valor: "494.99",
        papel: "gasto",
      },
      {
        dataMovimento: "2026-09-08",
        cartaoId: itau.id,
        tipo: "despesa",
        valor: "1582.79",
        papel: "gasto",
        parcelaNumero: 3,
        status: "previsto",
      },
      {
        dataMovimento: "2026-09-01",
        cartaoId: itau.id,
        tipo: "despesa",
        valor: "91.78",
        papel: "gasto",
        parcelaNumero: 1,
        status: "previsto",
      },
      {
        dataMovimento: "2026-08-31",
        cartaoId: itau.id,
        tipo: "despesa",
        valor: "100",
        papel: "gasto",
      },
      {
        dataMovimento: "2026-08-30",
        cartaoId: itau.id,
        tipo: "receita",
        valor: "8290.62",
        papel: "pagamento_fatura",
        competenciaFatura: "2026-09",
        ignoradoEmRelatorio: true,
      },
    ];
    const pagamentos = pagamentos_ciclo_de(movimentos);
    const porCartao = new Map([
      [itau.id, itau],
      [nu.id, nu],
      [revolut.id, revolut],
    ]);
    const naFatura = movimentos.filter((movimento) => {
      const cartao = movimento.cartaoId ? porCartao.get(movimento.cartaoId) : undefined;
      return na_fatura_do_recorte(movimento, {
        mes,
        hoje,
        fechamento: cartao?.fechamento,
        vencimento: cartao?.vencimento,
        pagamentos,
      });
    });
    expect(naFatura.map((item) => item.cartaoId).sort()).toEqual([
      itau.id,
      itau.id,
      itau.id,
      nu.id,
      revolut.id,
    ]);
    const total = naFatura.reduce((soma, item) => soma + Number(item.valor), 0);
    expect(total).toBeCloseTo(6489.66, 2);
  });

  it("crédito de atraso e estorno abatem; Pagamento recebido não", () => {
    const nu = { id: "nu", fechamento: 2, vencimento: 10 };
    const hoje = "2026-08-01";
    const mes = "2026-07";
    const movimentos = [
      {
        dataMovimento: "2026-06-12",
        cartaoId: nu.id,
        tipo: "despesa",
        valor: "9033.49",
        descricao: "Compras",
      },
      {
        dataMovimento: "2026-06-11",
        cartaoId: nu.id,
        tipo: "despesa",
        valor: "2954.05",
        descricao: "Saldo em atraso",
      },
      {
        dataMovimento: "2026-06-11",
        cartaoId: nu.id,
        tipo: "receita",
        valor: "2954.05",
        descricao: "Crédito de atraso",
      },
      {
        dataMovimento: "2026-06-11",
        cartaoId: nu.id,
        tipo: "despesa",
        valor: "70.82",
        descricao: "Juros de dívida encerrada",
      },
      {
        dataMovimento: "2026-06-11",
        cartaoId: nu.id,
        tipo: "receita",
        valor: "70.82",
        descricao: "Encerramento de dívida",
      },
      {
        dataMovimento: "2026-06-10",
        cartaoId: nu.id,
        tipo: "receita",
        valor: "2954.05",
        descricao: "Pagamento recebido",
      },
    ];
    const naFatura = movimentos.filter((movimento) =>
      na_fatura_do_recorte(movimento, {
        mes,
        hoje,
        fechamento: nu.fechamento,
        vencimento: nu.vencimento,
      }),
    );
    expect(naFatura.map((item) => item.descricao)).toEqual([
      "Compras",
      "Saldo em atraso",
      "Crédito de atraso",
      "Juros de dívida encerrada",
      "Encerramento de dívida",
    ]);
    expect(naFatura.reduce((soma, item) => soma + valor_na_fatura(item), 0)).toBeCloseTo(
      9033.49,
      2,
    );
  });

  it("eixo vencimento: Azul em junho é o ciclo que fechou em maio", () => {
    const noCiclo = {
      dataMovimento: "2026-05-20",
      cartaoId: itau.id,
      tipo: "despesa" as const,
    };
    const noCicloSeguinte = {
      dataMovimento: "2026-06-15",
      cartaoId: itau.id,
      tipo: "despesa" as const,
    };
    expect(
      na_fatura_do_recorte(noCiclo, {
        mes: "2026-06",
        hoje: "2026-09-02",
        fechamento: 30,
        vencimento: 6,
        eixo: "vencimento",
      }),
    ).toBe(true);
    expect(
      na_fatura_do_recorte(noCicloSeguinte, {
        mes: "2026-06",
        hoje: "2026-09-02",
        fechamento: 30,
        vencimento: 6,
        eixo: "vencimento",
      }),
    ).toBe(false);
    expect(
      na_fatura_do_recorte(noCiclo, {
        mes: "2026-06",
        hoje: "2026-09-02",
        fechamento: 2,
        vencimento: 10,
        eixo: "vencimento",
      }),
    ).toBe(true);
  });
});

describe("soma_cobrada_do_vencimento", () => {
  it("soma o Pix marcado no mês do vencimento", () => {
    expect(
      soma_cobrada_do_vencimento(
        [
          {
            cartaoFaturaId: "azul",
            cartaoId: null,
            papel: "pagamento_fatura",
            competenciaFatura: "2026-06",
            dataMovimento: "2026-06-01",
            valor: "5632.78",
          },
          {
            cartaoId: "azul",
            papel: "gasto",
            dataMovimento: "2026-05-20",
            valor: "100",
            tipo: "despesa",
          },
        ],
        "azul",
        "2026-06",
        30,
        6,
      ),
    ).toBeCloseTo(5632.78, 2);
  });
});

describe("eh_linha_da_fatura", () => {
  it("abate crédito do cartão e ignora quitação", () => {
    expect(
      eh_linha_da_fatura({
        cartaoId: "nu",
        tipo: "receita",
        descricao: "Crédito de atraso",
      }),
    ).toBe(true);
    expect(
      eh_linha_da_fatura({
        cartaoId: "nu",
        tipo: "receita",
        descricao: "Pagamento recebido",
      }),
    ).toBe(false);
    expect(
      eh_linha_da_fatura({
        cartaoId: "azul",
        tipo: "receita",
        descricao: "Pagamento PIX",
      }),
    ).toBe(false);
    expect(
      eh_linha_da_fatura({
        cartaoId: "nu",
        tipo: "receita",
        papel: "pagamento_fatura",
        descricao: "Pix",
      }),
    ).toBe(false);
    expect(valor_na_fatura({ tipo: "receita", valor: "70.82" })).toBe(-70.82);
    expect(valor_na_fatura({ tipo: "despesa", valor: "70.82" })).toBe(70.82);
  });
});

describe("aplicar_total_oficial", () => {
  it("fatura fechada usa o total do banco e expõe o residual", () => {
    expect(aplicar_total_oficial(9405.07, 9622.31)).toEqual({
      total: 9622.31,
      totalOficial: 9622.31,
      ajuste: 217.24,
    });
  });

  it("fatura aberta (sem oficial) fica na soma das linhas", () => {
    expect(aplicar_total_oficial(1893.4, null)).toEqual({
      total: 1893.4,
      totalOficial: null,
      ajuste: null,
    });
  });
});
