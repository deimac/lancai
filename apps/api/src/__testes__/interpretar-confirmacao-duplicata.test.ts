import { describe, expect, it } from "vitest";
import {
  extrair_pendencia_duplicata,
  interpretar_resposta_confirmacao_duplicata,
} from "../interpretar-confirmacao-duplicata";
import type { IntencaoRegistrarMovimento } from "@lancai/tipos";

const lancamento: IntencaoRegistrarMovimento = {
  intencao: "REGISTRAR_MOVIMENTO",
  tipo_movimento: "despesa",
  valor: 18.98,
  data_movimento: "2026-08-02",
  descricao: "Farmacia",
  perfil: "pf",
  cartao_nome: "Azul Itaú",
  forma_pagamento: "credito",
};

const historicoDuplicata = [
  { papel: "usuario" as const, conteudo: "gastei 18,98 na farmacia no cartao azul" },
  {
    papel: "sistema" as const,
    conteudo:
      'Já existe um lançamento igual: "Farmacia" de 02/08/2026 (R$\u00a018,98) no cartão Azul Itaú. Deseja registrar mesmo assim? Responda "sim" para confirmar ou "não" para cancelar.',
  },
];

describe("extrair_pendencia_duplicata", () => {
  it("detecta pergunta de duplicata na última mensagem do sistema", () => {
    expect(extrair_pendencia_duplicata(historicoDuplicata)).toBe(true);
  });

  it("retorna false quando não há pendência", () => {
    expect(extrair_pendencia_duplicata([{ papel: "sistema", conteudo: "Despesa registrada." }])).toBe(
      false,
    );
  });
});

describe("interpretar_resposta_confirmacao_duplicata", () => {
  it("confirma com sim e marca confirmado", () => {
    expect(
      interpretar_resposta_confirmacao_duplicata("sim", historicoDuplicata, lancamento),
    ).toEqual({ ...lancamento, confirmado: true });
  });

  it("cancela com não", () => {
    expect(
      interpretar_resposta_confirmacao_duplicata("não", historicoDuplicata, lancamento),
    ).toEqual({
      intencao: "NAO_RECONHECIDA",
      motivo: "Lançamento não registrado — já existia um igual.",
    });
  });

  it("ignora quando a última intenção não é registro", () => {
    expect(
      interpretar_resposta_confirmacao_duplicata("sim", historicoDuplicata, {
        intencao: "MENU",
      }),
    ).toBeNull();
  });

  it("ignora mensagens longas", () => {
    expect(
      interpretar_resposta_confirmacao_duplicata(
        "gastei 20 na farmacia",
        historicoDuplicata,
        lancamento,
      ),
    ).toBeNull();
  });
});
