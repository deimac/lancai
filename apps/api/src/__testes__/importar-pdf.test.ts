import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ErroValidacaoFinanceira } from "@lancai/financeiro";
import {
  exigir_destino_manual,
  id_externo_pdf,
  lotes_texto_pdf,
  montar_eventos_pdf,
  montar_preview_pdf,
  provedor_pdf_do_texto,
  resolver_par_pdf,
  rotear_linhas_pdf,
  texto_pdf_insuficiente,
  unir_linhas_extraidas,
  extrair_lancamentos_do_texto,
  linhas_visuais_pdf,
  parse_data_lancamento,
  type CandidatoDestinoPdf,
  type LinhaExtraidaPdf,
} from "../servicos/importar-pdf";

const CONTA: CandidatoDestinoPdf = {
  tipo: "conta",
  id: randomUUID(),
  nome: "Revolut",
  sincronizada: false,
};
const CARTAO: CandidatoDestinoPdf = {
  tipo: "cartao",
  id: randomUUID(),
  nome: "Revolut",
  contaId: CONTA.id,
  sincronizada: false,
};

const linhaConta: LinhaExtraidaPdf = {
  ocorridoEm: "2026-08-01",
  descricao: "PIX recebido",
  valor: 100,
  tipo: "receita",
  destinoSugerido: "conta",
};
const linhaCartao: LinhaExtraidaPdf = {
  ocorridoEm: "2026-08-02",
  descricao: "IFOOD",
  valor: 45.9,
  tipo: "despesa",
  destinoSugerido: "cartao",
};

describe("importar PDF", () => {
  describe("roteamento", () => {
    it("todas as linhas entram no destino do menu, sem escolher conta/cartão uma a uma", () => {
      const doCartao = rotear_linhas_pdf([linhaConta, linhaCartao], {
        origem: { tipo: "cartao", id: CARTAO.id, nome: CARTAO.nome },
      });
      expect(doCartao.every((linha) => linha.destino?.id === CARTAO.id)).toBe(true);
      expect(doCartao.every((linha) => linha.destinoSugerido === "cartao")).toBe(true);
      expect(doCartao.every((linha) => linha.aceita)).toBe(true);
      expect(doCartao.find((linha) => linha.descricao === "IFOOD")?.tipo).toBe("despesa");

      const daConta = rotear_linhas_pdf([linhaConta, linhaCartao], { origem: CONTA });
      expect(daConta.every((linha) => linha.destino?.id === CONTA.id)).toBe(true);
      expect(daConta.every((linha) => linha.destinoSugerido === "conta")).toBe(true);
    });

    it("não pede segundo destino mesmo com cartão ligado à conta", () => {
      const outro: CandidatoDestinoPdf = {
        tipo: "cartao",
        id: randomUUID(),
        nome: "Revolut Metal",
        contaId: CONTA.id,
        sincronizada: false,
      };
      const preview = montar_preview_pdf({
        linhas: [linhaConta, linhaCartao],
        origem: CARTAO,
        contas: [CONTA],
        cartoes: [CARTAO, outro],
        arquivoHash: "a".repeat(64),
        provedor: "revolut-pdf",
        textoInsuficiente: false,
      });
      expect(preview.precisaSegundoDestino).toBe(false);
      expect(preview.linhas.every((linha) => linha.destino?.id === CARTAO.id)).toBe(true);
    });

    it("casa pelo mesmo nome quando não há conta_id", () => {
      const cartaoSemVinculo: CandidatoDestinoPdf = { ...CARTAO, contaId: null };
      const { par } = resolver_par_pdf({
        origem: { tipo: "cartao", id: cartaoSemVinculo.id, nome: cartaoSemVinculo.nome },
        contas: [CONTA],
        cartoes: [cartaoSemVinculo],
      });
      expect(par?.id).toBe(CONTA.id);
    });
  });

  describe("dedup e destino sincronizado", () => {
    it("idExterno é estável para o mesmo arquivo + linha + destino", () => {
      const entrada = {
        arquivoHash: "b".repeat(64),
        ocorridoEm: "2026-08-02",
        valor: 45.9,
        descricao: "  IFOOD  ",
        tipo: "despesa",
        destinoId: CARTAO.id,
      };
      expect(id_externo_pdf(entrada)).toBe(id_externo_pdf({ ...entrada, descricao: "ifood" }));
    });

    it("recusa destino sincronizado", () => {
      expect(() => exigir_destino_manual({ nome: "Nubank", sincronizada: true })).toThrow(
        ErroValidacaoFinanceira,
      );
      expect(() => exigir_destino_manual({ nome: "Revolut", sincronizada: false })).not.toThrow();
    });

    it("montar_eventos recusa linha cujo destino está sincronizado", () => {
      expect(() =>
        montar_eventos_pdf({
          linhas: [
            {
              ...linhaCartao,
              destino: { tipo: "cartao", id: CARTAO.id, nome: CARTAO.nome },
            },
          ],
          destinos: [
            {
              tipo: "cartao",
              id: CARTAO.id,
              workspaceId: randomUUID(),
              sincronizada: true,
              nome: "Azul Itaú",
            },
          ],
          arquivoHash: "c".repeat(64),
          provedor: "pdf",
        }),
      ).toThrow(/sincronizada/);
    });

    it("eventos saem com fonte=pdf, fatoImutavel e o mesmo idExterno na reimportação", () => {
      const workspaceId = randomUUID();
      const arquivoHash = "d".repeat(64);
      const linha = {
        ...linhaCartao,
        destino: { tipo: "cartao" as const, id: CARTAO.id, nome: CARTAO.nome },
      };
      const destinos = [
        {
          tipo: "cartao" as const,
          id: CARTAO.id,
          workspaceId,
          sincronizada: false,
          nome: CARTAO.nome,
        },
      ];
      const primeira = montar_eventos_pdf({
        linhas: [linha],
        destinos,
        arquivoHash,
        provedor: "revolut-pdf",
      });
      const segunda = montar_eventos_pdf({
        linhas: [linha],
        destinos,
        arquivoHash,
        provedor: "revolut-pdf",
      });
      expect(primeira[0]?.fonte).toBe("pdf");
      expect(primeira[0]?.fatoImutavel).toBe(true);
      expect(primeira[0]?.cartaoId).toBe(CARTAO.id);
      expect(primeira[0]?.idExterno).toBe(segunda[0]?.idExterno);
    });
  });

  it("reconhece Revolut no texto e PDF só-imagem", () => {
    expect(provedor_pdf_do_texto("Statement Revolut Ltd")).toBe("revolut-pdf");
    expect(provedor_pdf_do_texto("Fatura Nubank")).toBe("pdf");
    expect(texto_pdf_insuficiente("   ")).toBe(true);
    expect(texto_pdf_insuficiente("Revolut statement August 2026 with several transactions")).toBe(
      false,
    );
  });

  it("agrupa páginas sem cortar no meio e une linhas repetidas entre trechos", () => {
    const lotes = lotes_texto_pdf(["aaaaaa", "bbbbbb", "cccccc"], 10);
    expect(lotes.length).toBeGreaterThan(1);
    expect(lotes[0]).toContain("aaaaaa");
    expect(lotes[0]).not.toContain("cccccc");

    const unidas = unir_linhas_extraidas([[linhaCartao], [linhaCartao, linhaConta]]);
    expect(unidas).toHaveLength(2);
  });

  it("extrai todos os lançamentos do texto, não só os primeiros 5", () => {
    const nomes = [
      "UBER *TRIP",
      "IFOOD",
      "SPOTIFY",
      "NETFLIX",
      "AMAZON",
      "RAPPI",
      "PADARIA",
      "FARMACIA",
      "POSTO SHELL",
      "CLARO",
      "GOOGLE",
      "APPLE.COM",
    ];
    const texto = [
      "Revolut statement",
      "1 August 2026",
      ...nomes.flatMap((nome, i) => [`Card Payment to ${nome}`, `- R$${(10 + i).toFixed(2)}`]),
      "From MARIA SILVA",
      "R$50.00",
      "2 August 2026",
      "ATM Withdrawal",
      "- R$100.00",
    ].join("\n");

    const linhas = extrair_lancamentos_do_texto(texto);
    expect(linhas.length).toBe(nomes.length + 2);
    expect(linhas.filter((l) => l.destinoSugerido === "cartao").length).toBe(nomes.length);
    expect(linhas.some((l) => l.descricao.includes("MARIA") && l.tipo === "receita")).toBe(true);
    const textoCorrido = nomes.map((nome, i) => `Card Payment to ${nome} - R$${(10 + i).toFixed(2)}`).join(" ");
    const doCorrido = extrair_lancamentos_do_texto(`1 August 2026 ${textoCorrido}`);
    expect(doCorrido.length).toBeGreaterThanOrEqual(nomes.length);
  });

  it("lê tabela Data Descrição Valor em português, sem herdar a data do cabeçalho", () => {
    const texto = [
      "Fatura do cartão",
      "Período 01/05/2026 a 31/05/2026",
      "Vencimento 10 de jun. de 2026",
      "Data Descrição Valor",
      "15 de mai. de 2026 Norte Sul Grill R$36,99",
      "16 de mai. de 2026 IFOOD R$45,90",
      "2 de jun. de 2026 UBER R$23,40",
      "Sobre as taxas: conversão de 6,12 e IOF de 1,10%.",
    ].join("\n");
    expect(parse_data_lancamento("15 de mai. de 2026")).toBe("2026-05-15");
    const linhas = extrair_lancamentos_do_texto(texto);
    expect(linhas).toHaveLength(3);
    expect(linhas[0]).toMatchObject({
      ocorridoEm: "2026-05-15",
      descricao: "Norte Sul Grill",
      valor: 36.99,
      tipo: "despesa",
    });
    expect(linhas[1]).toMatchObject({ ocorridoEm: "2026-05-16", valor: 45.9 });
    expect(linhas[1]?.descricao).toMatch(/IFOOD/i);
    expect(linhas[2]?.ocorridoEm).toBe("2026-06-02");
    expect(linhas.every((linha) => linha.ocorridoEm !== "2026-05-01")).toBe(true);
    expect(linhas.every((linha) => !/mai\.|2026|período|taxa/i.test(linha.descricao))).toBe(true);
  });

  it("lê data e valor na mesma linha (extrato BR)", () => {
    const texto = Array.from({ length: 8 }, (_, i) => {
      const dia = String(i + 1).padStart(2, "0");
      return `${dia}/08/2026 PIX Enviado Fulano ${i + 1} 12,3${i}`;
    }).join("\n");
    const linhas = extrair_lancamentos_do_texto(texto);
    expect(linhas.length).toBe(8);
    expect(linhas[0]?.ocorridoEm).toBe("2026-08-01");
    expect(linhas[7]?.ocorridoEm).toBe("2026-08-08");
  });

  it("reconstrói linhas visuais pela posição Y do PDF", () => {
    const linhas = linhas_visuais_pdf([
      { str: "IFOOD", x: 10, y: 200 },
      { str: "45.90", x: 300, y: 200 },
      { str: "UBER", x: 10, y: 160 },
      { str: "12.00", x: 300, y: 161 },
    ]);
    expect(linhas).toEqual(["IFOOD 45.90", "UBER 12.00"]);
  });

  it("junta um token por linha e várias compras no mesmo dia", () => {
    const texto = [
      "9",
      "Jun",
      "2026",
      "Card",
      "Payment",
      "to",
      "UBER",
      "-23.40",
      "Card",
      "Payment",
      "to",
      "IFOOD",
      "-45.90",
      "10",
      "Jun",
      "2026",
      "ATM",
      "Withdrawal",
      "-100.00",
    ].join("\n");
    const linhas = extrair_lancamentos_do_texto(texto);
    expect(linhas).toHaveLength(3);
    expect(linhas[0]).toMatchObject({
      ocorridoEm: "2026-06-09",
      valor: 23.4,
      tipo: "despesa",
      destinoSugerido: "cartao",
    });
    expect(linhas[0]?.descricao).toMatch(/UBER/i);
    expect(linhas[1]).toMatchObject({
      ocorridoEm: "2026-06-09",
      valor: 45.9,
      destinoSugerido: "cartao",
    });
    expect(linhas[1]?.descricao).toMatch(/IFOOD/i);
    expect(linhas[2]).toMatchObject({
      ocorridoEm: "2026-06-10",
      valor: 100,
      destinoSugerido: "conta",
    });
  });

  it("não transforma período e saldo do cabeçalho em lançamento", () => {
    const texto = [
      "Statement period 1 Jun 2026 - 30 Jun 2026",
      "Opening balance 1,234.56",
      "IBAN GB00 REVO 0000 0000",
      "9 Jun 2026 Card Payment to UBER -23.40",
    ].join("\n");
    const linhas = extrair_lancamentos_do_texto(texto);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.descricao).toMatch(/UBER/i);
    expect(linhas[0]?.valor).toBe(23.4);
  });

  it("ignora prosa de taxa/câmbio e fica no padrão que se repete", () => {
    const texto = [
      "A Card Payment to a merchant may include a variable fee of 0.40% converted from EUR at exchange rate 6.12",
      "This fee applies when you spend abroad. Fair usage 1,000.00.",
      "9 Jun 2026",
      "Card Payment to UBER -23.40 Fee 0.00 1,500.00",
      "Card Payment to IFOOD 45.90 Fee 0.40 1,454.10",
      "Card Payment to SPOTIFY 21.90",
      "10 Jun 2026 Card Payment to NETFLIX 32.90",
    ].join("\n");
    const linhas = extrair_lancamentos_do_texto(texto);
    expect(linhas).toHaveLength(4);
    expect(linhas.every((linha) => linha.tipo === "despesa")).toBe(true);
    expect(linhas.map((linha) => linha.valor)).toEqual([23.4, 45.9, 21.9, 32.9]);
    expect(linhas.some((linha) => /fee|exchange|fair usage/i.test(linha.descricao))).toBe(false);
  });

  it("no cartão, valor sem sinal é despesa que consome limite", () => {
    const extraidas = extrair_lancamentos_do_texto(
      "9 Jun 2026 Card Payment to UBER 23.40 Card Payment to IFOOD 45.90",
    );
    expect(extraidas.every((linha) => linha.tipo === "despesa")).toBe(true);

    const conferidas = rotear_linhas_pdf(extraidas, {
      origem: { tipo: "cartao", id: CARTAO.id, nome: CARTAO.nome },
    });
    expect(conferidas.every((linha) => linha.tipo === "despesa")).toBe(true);
    expect(conferidas.every((linha) => linha.destino?.id === CARTAO.id)).toBe(true);
  });
});
