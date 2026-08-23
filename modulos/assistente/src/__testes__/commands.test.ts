import { describe, expect, it } from "vitest";
import { montarCancelTransaction, montarCreateTransaction, montarUpdateTransaction } from "../comandos/handlers";

const CONTA = "00000000-0000-4000-8000-000000000202";
const CARTAO = "00000000-0000-4000-8000-000000000203";
const MOV = "00000000-0000-4000-8000-000000000101";

describe("Command handlers", () => {
  describe("create_transaction", () => {
    it("despesa em conta", () => {
      const r = montarCreateTransaction({
        tipo: "despesa",
        valor: 50,
        dataMovimento: "2026-08-23",
        descricao: "Uber",
        contaId: CONTA,
        formaPagamento: "pix",
      });
      expect(r.ok).toBe(true);
    });

    it("crédito exige cartão", () => {
      const r = montarCreateTransaction({
        tipo: "despesa",
        valor: 50,
        dataMovimento: "2026-08-23",
        descricao: "Uber",
        formaPagamento: "credito",
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain("Cartão");
    });

    it("crédito recusa conta", () => {
      const r = montarCreateTransaction({
        valor: 50,
        descricao: "Uber",
        formaPagamento: "credito",
        cartaoId: CARTAO,
        contaId: CONTA,
      });
      expect(r.ok).toBe(false);
    });

    it("transferência exige duas contas diferentes", () => {
      const r = montarCreateTransaction({
        tipo: "transferencia",
        valor: 10,
        descricao: "Pix",
        contaId: CONTA,
      });
      expect(r.ok).toBe(false);
    });

    it("transferência com duas contas", () => {
      const dest = "00000000-0000-4000-8000-000000000204";
      const r = montarCreateTransaction({
        tipo: "transferencia",
        valor: 10,
        descricao: "Pix",
        contaId: CONTA,
        contaDestinoId: dest,
        dataMovimento: "2026-08-23",
      });
      expect(r.ok).toBe(true);
    });
  });

  describe("update_transaction", () => {
    it("fato + conhecimento", () => {
      const r = montarUpdateTransaction({
        movementId: MOV,
        params: { valor: 80, perfil: "pj" },
      });
      expect(r.ok).toBe(true);
      if (r.ok && r.value.type === "update_transaction") {
        expect(r.value.input.fatoPatch?.valor).toBe(80);
        expect(r.value.input.conhecimentoPatch?.perfil).toBe("pj");
      }
    });

    it("sem campos", () => {
      const r = montarUpdateTransaction({ movementId: MOV, params: {} });
      expect(r.ok).toBe(false);
    });
  });

  describe("cancel_transaction", () => {
    it("monta comando", () => {
      const r = montarCancelTransaction(MOV);
      expect(r.ok).toBe(true);
    });
  });
});
