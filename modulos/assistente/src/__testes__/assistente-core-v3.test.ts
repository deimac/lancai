import { describe, expect, it } from "vitest";
import { documentoMistoDeContextoV3 } from "../agente/documento-misto";
import { MOVIMENTO_UBER, contextoAposConsultaUber } from "./casos-understanding";
import { criarAssistenteCoreV3Teste } from "./helpers-assistente-v3";
import { IDS } from "./helpers-assistente";

describe("AssistenteCoreV3", () => {
  it("create resolve conta por nome, pede confirmação e executa no sim", async () => {
    const { core, repo } = criarAssistenteCoreV3Teste();
    const r1 = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Gastei 50 no Uber no Nubank",
      canal: "web",
    });
    expect(r1.diagnostico?.confirm).toBe(true);
    expect(r1.resposta.toLowerCase()).toMatch(/confirmar|uber/);

    const bruto = await repo.getDocumento(r1.sessaoId);
    expect(bruto?.documento.schemaVersion).toBe(1);
    expect((bruto?.documento.pending_action as { type?: string } | null)?.type).toBe("confirmation");

    const r2 = await core.processar({
      usuarioId: IDS.user,
      mensagem: "sim",
      sessaoId: r1.sessaoId,
      canal: "web",
    });
    expect(r2.diagnostico?.executed).toBe(true);
    expect(r2.diagnostico?.war).toBeNull();
    expect(r2.resposta.toLowerCase()).toMatch(/lançad|uber/);
  });

  it("query Uber", async () => {
    const { core } = criarAssistenteCoreV3Teste();
    const r = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Quanto gastei com Uber?",
      canal: "web",
    });
    expect(r.diagnostico?.op).toBe("query");
    expect(r.diagnostico?.executed).toBe(true);
    expect(r.resposta.toLowerCase()).toMatch(/encontrei/);
  });

  it("period_shift herda Uber", async () => {
    const { core, repo } = criarAssistenteCoreV3Teste();
    const doc = await repo.createDocumento(IDS.user, documentoMistoDeContextoV3(contextoAposConsultaUber()));
    const r = await core.processar({
      usuarioId: IDS.user,
      mensagem: "E mês passado?",
      sessaoId: doc.id,
      canal: "web",
    });
    expect(r.diagnostico?.op).toBe("query");
    expect(r.diagnostico?.executed).toBe(true);
  });

  it("foi ontem pede confirmação de update", async () => {
    const { core, repo, movimentos } = criarAssistenteCoreV3Teste();
    movimentos.set(MOVIMENTO_UBER, {
      id: MOVIMENTO_UBER,
      type: "transaction",
      label: "Uber",
      metadata: { merchant: "Uber", valor: 42, dataMovimento: "2026-08-22" },
    });
    const doc = await repo.createDocumento(IDS.user, documentoMistoDeContextoV3(contextoAposConsultaUber()));
    const r = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Foi ontem",
      sessaoId: doc.id,
      canal: "web",
    });
    expect(r.diagnostico?.op).toBe("update");
    expect(r.diagnostico?.confirm || r.diagnostico?.executed).toBeTruthy();
  });

  it("ambíguo pede esclarecimento", async () => {
    const { core, repo } = criarAssistenteCoreV3Teste();
    const doc = await repo.createDocumento(IDS.user, documentoMistoDeContextoV3(contextoAposConsultaUber()));
    const r = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Corrige o Uber",
      sessaoId: doc.id,
      canal: "web",
    });
    expect(r.diagnostico?.clarification).toBe(true);
    expect(r.resposta.toLowerCase()).toMatch(/uber|detalhe|qual/);
  });

  it("OF delete é bloqueado", async () => {
    const ofTarget = {
      id: MOVIMENTO_UBER,
      type: "transaction" as const,
      label: "Uber",
      metadata: { fatoImutavel: true, fonte: "open_finance", merchant: "Uber" },
    };
    const { core, repo } = criarAssistenteCoreV3Teste({ ofTarget });
    const ctx = {
      ...contextoAposConsultaUber(),
      focused_entity: ofTarget,
    };
    const doc = await repo.createDocumento(IDS.user, documentoMistoDeContextoV3(ctx));
    const r = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Apaga aquele lançamento do banco",
      sessaoId: doc.id,
      canal: "web",
    });
    expect(r.diagnostico?.blocked).toBe(true);
    expect(r.diagnostico?.reason).toBe("of_cannot_delete");
    expect(r.diagnostico?.executed).toBeFalsy();
  });

  it("greet não chama o Core financeiro", async () => {
    const { core } = criarAssistenteCoreV3Teste();
    const r = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Oi, tudo bem?",
      canal: "web",
    });
    expect(r.diagnostico?.op).toBe("greet");
    expect(r.resposta).toMatch(/olá/i);
    expect(r.diagnostico?.executed).toBeFalsy();
  });

  it("duplicata WhatsApp não reprocessa", async () => {
    const { core } = criarAssistenteCoreV3Teste();
    const r1 = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Oi, tudo bem?",
      canal: "whatsapp",
      messageId: "wa-1",
    });
    expect(r1.duplicata).toBeFalsy();
    const r2 = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Oi, tudo bem?",
      canal: "whatsapp",
      messageId: "wa-1",
    });
    expect(r2.duplicata).toBe(true);
    expect(r2.resposta).toMatch(/já processei/i);
  });

  it("shadow não grava sessão nem messageId", async () => {
    const { core, repo, manager } = criarAssistenteCoreV3Teste();
    const r = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Gastei 50 no Uber no Nubank",
      canal: "whatsapp",
      messageId: "wa-shadow",
      somenteLeitura: true,
    });
    expect(r.diagnostico?.confirm || r.diagnostico?.reason === "shadow").toBeTruthy();
    expect(await repo.getDocumento(r.sessaoId)).toBeNull();
    expect(await repo.getDocumentoByUsuarioAtiva(IDS.user)).toBeNull();
    expect(await manager.jaProcessado("wa-shadow")).toBe(false);
  });
});
