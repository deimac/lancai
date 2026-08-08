import { describe, expect, it } from "vitest";
import type { MensagemHistorico } from "@lancai/ia";
import type { IntencaoCorrigirMovimento } from "@lancai/tipos";
import {
  extrair_pendencia_virar_regra,
  interpretar_resposta_confirmacao_regra,
} from "../interpretar-confirmacao-regra";
import { montar_oferta_virar_regra } from "../montar-oferta-virar-regra";

const oferta = montar_oferta_virar_regra({
  movimentoId: "00000000-0000-4000-8000-000000000099",
  trecho: "IFOOD",
  categoriaId: "00000000-0000-4000-8000-000000000010",
  categoriaNome: "Restaurantes",
});

const historicoOferta: MensagemHistorico[] = [
  { papel: "usuario", conteudo: "classifica o ifood como Restaurantes" },
  {
    papel: "sistema",
    conteudo: `Lançamento "IFOOD *LOOP" atualizado com sucesso.\n\n${oferta}`,
  },
];

const ultimaCorrecao: IntencaoCorrigirMovimento = {
  intencao: "CORRIGIR_MOVIMENTO",
  referencia: { descricao: "IFOOD", data_movimento: null, codigo: null },
  campos_alterados: { categoria_nome: "Restaurantes" },
};

describe("extrair_pendencia_virar_regra", () => {
  it("detecta a oferta na última mensagem do sistema", () => {
    expect(extrair_pendencia_virar_regra(historicoOferta)).toBe(true);
  });

  it("ignora mensagens sem oferta", () => {
    expect(
      extrair_pendencia_virar_regra([{ papel: "sistema", conteudo: "Lançamento atualizado." }]),
    ).toBe(false);
  });
});

describe("interpretar_resposta_confirmacao_regra", () => {
  it("aceita com sim e copia a referência da correção", () => {
    expect(interpretar_resposta_confirmacao_regra("sim", historicoOferta, ultimaCorrecao)).toEqual({
      intencao: "CRIAR_REGRA_APRENDIZADO",
      confirmado: true,
      referencia: ultimaCorrecao.referencia,
    });
  });

  it("recusa com não", () => {
    expect(interpretar_resposta_confirmacao_regra("não", historicoOferta, ultimaCorrecao)).toEqual({
      intencao: "CRIAR_REGRA_APRENDIZADO",
      confirmado: false,
    });
  });

  it("aceita pular como recusa", () => {
    expect(interpretar_resposta_confirmacao_regra("pular", historicoOferta, ultimaCorrecao)).toEqual(
      {
        intencao: "CRIAR_REGRA_APRENDIZADO",
        confirmado: false,
      },
    );
  });

  it("não intercepta sem oferta pendente", () => {
    expect(
      interpretar_resposta_confirmacao_regra("sim", [{ papel: "sistema", conteudo: "Ok." }], ultimaCorrecao),
    ).toBeNull();
  });

  it("não intercepta se a correção anterior não mudou categoria", () => {
    expect(
      interpretar_resposta_confirmacao_regra("sim", historicoOferta, {
        intencao: "CORRIGIR_MOVIMENTO",
        referencia: { descricao: "IFOOD" },
        campos_alterados: { descricao: "Almoço" },
      }),
    ).toBeNull();
  });
});
