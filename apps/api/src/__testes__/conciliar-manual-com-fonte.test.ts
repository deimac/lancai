import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Movimento } from "@lancai/banco";
import {
  escolher_pares_conciliacao,
  score_descricao_conciliacao,
} from "../servicos/conciliar-manual-com-fonte";

function mov(parcial: Partial<Movimento> & { id: string; descricao: string }): Movimento {
  const agora = new Date();
  return {
    workspaceId: randomUUID(),
    fonte: "manual",
    provedor: null,
    idExterno: null,
    descricaoFonte: parcial.descricao,
    favorecidoFonte: null,
    statusFonte: "confirmado",
    valor: "45.00",
    tipo: "despesa",
    status: "realizado",
    tipoGasto: "pf",
    formaPagamento: "pix",
    dataMovimento: "2026-08-01",
    contaId: "conta-1",
    cartaoId: null,
    categoriaId: randomUUID(),
    pessoaId: null,
    tags: [],
    observacoes: null,
    classificadoPor: "usuario",
    confiancaIa: null,
    ignoradoEmRelatorio: false,
    usuarioId: randomUUID(),
    dataLancamento: agora,
    dataCriacao: agora,
    dataAtualizacao: agora,
    criadoPor: randomUUID(),
    alteradoPor: null,
    ...parcial,
  } as Movimento;
}

describe("score_descricao_conciliacao", () => {
  it("casa iFood do usuário com descrição de bandeira", () => {
    expect(score_descricao_conciliacao("iFood", "COMPRA CARTAO IFOOD *99", null)).toBeGreaterThan(
      0.3,
    );
  });

  it("rejeita descrições sem relação", () => {
    expect(score_descricao_conciliacao("Uber", "FARMACIA DROGASIL", null)).toBeLessThan(0.35);
  });
});

describe("escolher_pares_conciliacao", () => {
  it("casa 1:1 por valor, data próxima e descrição", () => {
    const contaId = "conta-1";
    const fato = mov({
      id: "fato-1",
      fonte: "open_finance",
      descricao: "Não classificado",
      descricaoFonte: "IFOOD *ABC",
      valor: "45.00",
      dataMovimento: "2026-08-02",
      contaId,
    });
    const manual = mov({
      id: "manual-1",
      fonte: "whatsapp",
      descricao: "iFood",
      valor: "45.00",
      dataMovimento: "2026-08-01",
      contaId,
    });
    const outro = mov({
      id: "manual-2",
      fonte: "manual",
      descricao: "Farmácia",
      valor: "45.00",
      dataMovimento: "2026-08-01",
      contaId,
    });

    const pares = escolher_pares_conciliacao([fato], [manual, outro]);
    expect(pares).toEqual([{ fatoId: "fato-1", manualId: "manual-1", score: expect.any(Number) }]);
  });

  it("não casa valor diferente", () => {
    const fato = mov({
      id: "fato-1",
      fonte: "open_finance",
      descricao: "x",
      descricaoFonte: "IFOOD",
      valor: "50.00",
      contaId: "c",
    });
    const manual = mov({
      id: "manual-1",
      descricao: "iFood",
      valor: "45.00",
      contaId: "c",
    });
    expect(escolher_pares_conciliacao([fato], [manual])).toEqual([]);
  });

  it("casa recorrência a 5 dias com janela de 7 e recusa na janela de 3", () => {
    const contaId = "conta-1";
    const fato = mov({
      id: "fato-1",
      fonte: "open_finance",
      descricao: "Não classificado",
      descricaoFonte: "NETFLIX.COM",
      valor: "55.90",
      dataMovimento: "2026-08-15",
      contaId,
    });
    const gerado = mov({
      id: "rec-1",
      fonte: "recorrencia",
      descricao: "Netflix",
      valor: "55.90",
      dataMovimento: "2026-08-10",
      contaId,
    });

    expect(escolher_pares_conciliacao([fato], [gerado], 3)).toEqual([]);
    expect(escolher_pares_conciliacao([fato], [gerado], 7)).toEqual([
      { fatoId: "fato-1", manualId: "rec-1", score: expect.any(Number) },
    ]);
  });

  it("não casa recorrência de conta ou valor diferentes", () => {
    const fato = mov({
      id: "fato-1",
      fonte: "open_finance",
      descricao: "x",
      descricaoFonte: "NETFLIX.COM",
      valor: "55.90",
      dataMovimento: "2026-08-12",
      contaId: "conta-a",
    });
    const outraConta = mov({
      id: "rec-1",
      fonte: "recorrencia",
      descricao: "Netflix",
      valor: "55.90",
      dataMovimento: "2026-08-10",
      contaId: "conta-b",
    });
    const outroValor = mov({
      id: "rec-2",
      fonte: "recorrencia",
      descricao: "Netflix",
      valor: "39.90",
      dataMovimento: "2026-08-10",
      contaId: "conta-a",
    });

    expect(escolher_pares_conciliacao([fato], [outraConta], 7)).toEqual([]);
    expect(escolher_pares_conciliacao([fato], [outroValor], 7)).toEqual([]);
  });
});
