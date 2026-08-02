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
