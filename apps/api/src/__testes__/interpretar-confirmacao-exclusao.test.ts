import { describe, expect, it } from "vitest";
import {
  extrair_pendencia_exclusao,
  interpretar_resposta_confirmacao_exclusao,
} from "../interpretar-confirmacao-exclusao";

const historicoCartao = [
  { papel: "usuario" as const, conteudo: "excluir cartão Nubank" },
  {
    papel: "sistema" as const,
    conteudo:
      'Deseja realmente excluir o cartão "Nubank"? Responda "sim" para confirmar ou "não" para cancelar.',
  },
];

const historicoContaComLancamentos = [
  { papel: "usuario" as const, conteudo: "excluir conta C6 Bank" },
  {
    papel: "sistema" as const,
    conteudo:
      'Deseja realmente excluir a conta "C6 Bank"? Atenção: existe 1 lançamento vinculado a essa conta — a conta some da listagem, mas o histórico dos lançamentos é preservado. Responda "sim" para confirmar ou "não" para cancelar.',
  },
];

const historicoLancamento = [
  { papel: "usuario" as const, conteudo: "cancela o almoço de hoje" },
  {
    papel: "sistema" as const,
    conteudo:
      'Deseja realmente excluir o lançamento "Almoço" de 02/08/2026 (R$\u00a045,00)? Responda "sim" para confirmar ou "não" para cancelar.',
  },
];

describe("extrair_pendencia_exclusao", () => {
  it("detecta cartão na última mensagem do sistema", () => {
    expect(extrair_pendencia_exclusao(historicoCartao)).toEqual({
      tipo: "cartão",
      nome: "Nubank",
    });
  });

  it("detecta conta mesmo com aviso de lançamentos", () => {
    expect(extrair_pendencia_exclusao(historicoContaComLancamentos)).toEqual({
      tipo: "conta",
      nome: "C6 Bank",
    });
  });

  it("detecta lançamento com data convertida para ISO", () => {
    expect(extrair_pendencia_exclusao(historicoLancamento)).toEqual({
      tipo: "lançamento",
      descricao: "Almoço",
      dataMovimento: "2026-08-02",
      codigo: null,
    });
  });

  it("detecta exclusão em lote", () => {
    expect(
      extrair_pendencia_exclusao([
        {
          papel: "sistema",
          conteudo:
            'Deseja realmente excluir os 2 lançamentos de "farmacia" de 02/08/2026 (total R$\u00a037,96)? Responda "sim" para confirmar ou "não" para cancelar.',
        },
      ]),
    ).toEqual({
      tipo: "lançamento",
      descricao: "farmacia",
      dataMovimento: "2026-08-02",
      codigo: null,
    });
  });

  it("detecta código curto no lançamento único", () => {
    expect(
      extrair_pendencia_exclusao([
        {
          papel: "sistema",
          conteudo:
            'Deseja realmente excluir o lançamento "farmacia" #a1b2c3d4 de 03/08/2026 (R$\u00a018,98)? Responda "sim" para confirmar ou "não" para cancelar.',
        },
      ]),
    ).toEqual({
      tipo: "lançamento",
      descricao: "farmacia",
      dataMovimento: "2026-08-03",
      codigo: "a1b2c3d4",
    });
  });

  it("retorna null quando não há confirmação pendente", () => {
    expect(
      extrair_pendencia_exclusao([{ papel: "sistema", conteudo: "Conta atualizada." }]),
    ).toBeNull();
  });
});

describe("interpretar_resposta_confirmacao_exclusao", () => {
  it("confirma exclusão de cartão com sim", () => {
    expect(interpretar_resposta_confirmacao_exclusao("sim", historicoCartao)).toEqual({
      intencao: "CORRIGIR_CARTAO",
      cartao_nome: "Nubank",
      campos_alterados: { ativo: false, confirmado: true },
    });
  });

  it("confirma exclusão de conta com confirmo", () => {
    expect(
      interpretar_resposta_confirmacao_exclusao("confirmo", historicoContaComLancamentos),
    ).toEqual({
      intencao: "CORRIGIR_CONTA",
      conta_nome: "C6 Bank",
      campos_alterados: { ativo: false, confirmado: true },
    });
  });

  it("confirma exclusão de lançamento com sim", () => {
    expect(interpretar_resposta_confirmacao_exclusao("sim", historicoLancamento)).toEqual({
      intencao: "CORRIGIR_MOVIMENTO",
      referencia: { descricao: "Almoço", data_movimento: "2026-08-02", codigo: null },
      campos_alterados: { status: "cancelado", confirmado: true },
    });
  });

  it("cancela exclusão com não", () => {
    expect(interpretar_resposta_confirmacao_exclusao("não", historicoCartao)).toEqual({
      intencao: "NAO_RECONHECIDA",
      motivo: "Exclusão cancelada.",
    });
  });

  it("ignora mensagens que não são resposta curta de confirmação", () => {
    expect(
      interpretar_resposta_confirmacao_exclusao("excluir cartão Inter", historicoCartao),
    ).toBeNull();
  });

  it("ignora quando não há pendência", () => {
    expect(interpretar_resposta_confirmacao_exclusao("sim", [])).toBeNull();
  });
});
