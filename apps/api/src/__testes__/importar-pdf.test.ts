import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ErroValidacaoFinanceira } from "@lancai/financeiro";
import {
  aplicar_segundo_destino,
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
    it("do menu da conta, manda linha de cartão para o cartão ligado por conta_id", () => {
      const { par, candidatosPar } = resolver_par_pdf({
        origem: CONTA,
        contas: [CONTA],
        cartoes: [CARTAO],
      });
      expect(par).toEqual({ tipo: "cartao", id: CARTAO.id, nome: CARTAO.nome });
      expect(candidatosPar).toHaveLength(1);

      const linhas = rotear_linhas_pdf([linhaConta, linhaCartao], { origem: CONTA, par });
      expect(linhas[0]?.destino?.id).toBe(CONTA.id);
      expect(linhas[0]?.aceita).toBe(true);
      expect(linhas[1]?.destino?.id).toBe(CARTAO.id);
      expect(linhas[1]?.aceita).toBe(true);
    });

    it("só cartão, sem conta: linha de conta cai no cartão marcada, para desmarcar ou trocar destino", () => {
      const origem = { tipo: "cartao" as const, id: CARTAO.id, nome: CARTAO.nome };
      const cartaoSolto: CandidatoDestinoPdf = { ...CARTAO, contaId: null };
      const { par, candidatosPar } = resolver_par_pdf({
        origem,
        contas: [],
        cartoes: [cartaoSolto],
      });
      expect(par).toBeNull();
      expect(candidatosPar).toHaveLength(0);

      const linhas = rotear_linhas_pdf([linhaConta, linhaCartao], { origem, par: null });
      expect(linhas[0]?.destino?.id).toBe(CARTAO.id);
      expect(linhas[0]?.aceita).toBe(true);
      expect(linhas[1]?.destino?.id).toBe(CARTAO.id);
      expect(linhas[1]?.aceita).toBe(true);
    });

    it("vários cartões ligados pedem o segundo destino no preview", () => {
      const outro: CandidatoDestinoPdf = {
        tipo: "cartao",
        id: randomUUID(),
        nome: "Revolut Metal",
        contaId: CONTA.id,
        sincronizada: false,
      };
      const preview = montar_preview_pdf({
        linhas: [linhaConta, linhaCartao],
        origem: CONTA,
        contas: [CONTA],
        cartoes: [CARTAO, outro],
        arquivoHash: "a".repeat(64),
        provedor: "revolut-pdf",
        textoInsuficiente: false,
      });
      expect(preview.par).toBeNull();
      expect(preview.precisaSegundoDestino).toBe(true);
      expect(preview.candidatosPar).toHaveLength(2);

      const escolhido = { tipo: "cartao" as const, id: outro.id, nome: outro.nome };
      const comPar = aplicar_segundo_destino(preview.linhas, escolhido);
      expect(comPar[1]?.destino?.id).toBe(outro.id);
      expect(comPar[1]?.aceita).toBe(true);
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
});
