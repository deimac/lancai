import { describe, expect, it } from "vitest";
import { descricao_ainda_automatica, enxugar_descricao_fonte } from "../enxugar-descricao-fonte";

describe("enxugar_descricao_fonte", () => {
  it("tira prefixos conhecidos e deixa o restante", () => {
    expect(enxugar_descricao_fonte("Pagamento com QR Pix MUNICIPIO DE SAO PAULO")).toBe(
      "MUNICIPIO DE SAO PAULO",
    );
    expect(enxugar_descricao_fonte("Pix recebido Tayna Silva")).toBe("Tayna Silva");
    expect(enxugar_descricao_fonte("Pix enviado Mercado Livre")).toBe("Mercado Livre");
    expect(enxugar_descricao_fonte("Pagamento QR Pix PREFEITURA")).toBe("PREFEITURA");
    expect(enxugar_descricao_fonte("Pagamento de conta COPEL-DIS")).toBe("COPEL-DIS");
    expect(enxugar_descricao_fonte("Pagamento de conta MUNICIPIO DE MARINGA")).toBe(
      "MUNICIPIO DE MARINGA",
    );
    expect(enxugar_descricao_fonte("Transferência Pix Ana Costa")).toBe("Ana Costa");
    expect(enxugar_descricao_fonte("Transferencia Pix Ana Costa")).toBe("Ana Costa");
    expect(enxugar_descricao_fonte("Transferência Pix enviada TAYNA SANTOS SILVA")).toBe(
      "TAYNA SANTOS SILVA",
    );
    expect(enxugar_descricao_fonte("TED recebida João")).toBe("João");
    expect(enxugar_descricao_fonte("TED enviada Fornecedor")).toBe("Fornecedor");
    expect(enxugar_descricao_fonte("TED MUNICIPIO")).toBe("MUNICIPIO");
    expect(enxugar_descricao_fonte("Transferência recebida Carla")).toBe("Carla");
    expect(enxugar_descricao_fonte("Transferência enviada Aluguel")).toBe("Aluguel");
  });

  it("ignora caixa e casa prefixo só no início", () => {
    expect(enxugar_descricao_fonte("PIX RECEBIDO Tayna Silva")).toBe("Tayna Silva");
    expect(enxugar_descricao_fonte("pagamento com qr pix MUNICIPIO")).toBe("MUNICIPIO");
    expect(enxugar_descricao_fonte("IFOOD *LOOP")).toBe("IFOOD *LOOP");
    expect(enxugar_descricao_fonte("Tedesco Bar")).toBe("Tedesco Bar");
    expect(enxugar_descricao_fonte("Compra Pix recebido extra")).toBe("Compra Pix recebido extra");
  });

  it("colapsa quebra de linha e espaços extras em uma linha", () => {
    expect(enxugar_descricao_fonte("Pix recebido\nTayna   Silva")).toBe("Tayna Silva");
    expect(enxugar_descricao_fonte("  IFOOD   *LOOP  ")).toBe("IFOOD *LOOP");
  });

  it("prefixo sozinho permanece o original", () => {
    expect(enxugar_descricao_fonte("Pix recebido")).toBe("Pix recebido");
    expect(enxugar_descricao_fonte("TED")).toBe("TED");
    expect(enxugar_descricao_fonte("  Pagamento com QR Pix  ")).toBe("Pagamento com QR Pix");
    expect(enxugar_descricao_fonte("Pagamento de conta")).toBe("Pagamento de conta");
  });
});

describe("descricao_ainda_automatica", () => {
  it("reconhece cópia bruta e cópia já enxuta", () => {
    expect(descricao_ainda_automatica("Pix recebido Tayna", "Pix recebido Tayna")).toBe(true);
    expect(descricao_ainda_automatica("Tayna", "Pix recebido Tayna")).toBe(true);
    expect(descricao_ainda_automatica("Apelido da Tayna", "Pix recebido Tayna")).toBe(false);
  });
});
