import { describe, expect, it } from "vitest";
import {
  extrair_pendencia_senha_cartao,
  mensagem_parece_senha,
  redigir_senha_no_historico,
} from "../interpretar-confirmacao-senha-cartao";
import { montar_pedido_senha_cartao } from "../montar-pedido-senha-cartao";
import { montar_dados_cartao_protegidos } from "../montar-dados-cartao";

describe("pedido de senha do cartão", () => {
  it("extrai o nome do cartão da pergunta padrão", () => {
    const historico = [
      { papel: "usuario" as const, conteudo: "dados do cartão Nubank" },
      { papel: "sistema" as const, conteudo: montar_pedido_senha_cartao("Nubank") },
    ];
    expect(extrair_pendencia_senha_cartao(historico)).toBe("Nubank");
  });

  it("reconhece candidatos a senha e rejeita respostas curtas de confirmação", () => {
    expect(mensagem_parece_senha("minhaSenha123")).toBe(true);
    expect(mensagem_parece_senha("sim")).toBe(false);
    expect(mensagem_parece_senha("cancela o almoço de hoje")).toBe(false);
  });

  it("redige a senha no histórico", () => {
    expect(redigir_senha_no_historico()).toBe("[senha omitida]");
  });

  it("formata os dados protegidos do cartão", () => {
    const texto = montar_dados_cartao_protegidos(
      {
        id: "1",
        nome: "Nubank",
        limite: "5000.00",
        fechamento: 10,
        vencimento: 17,
        melhorDiaCompra: 11,
        perfil: "pf",
        modalidade: "credito",
        ativo: true,
        final4: "1111",
        dadosPlasticosCifrados: "x",
        contaId: "c",
        usuarioId: "u",
        dataCriacao: new Date(),
        dataAtualizacao: new Date(),
      },
      { numero: "4111111111111111", validade: "08/30", cvv: "123" },
    );
    expect(texto).toContain('Dados do cartão "Nubank"');
    expect(texto).toContain("4111 1111 1111 1111");
    expect(texto).toContain("08/30");
    expect(texto).toContain("123");
  });
});
