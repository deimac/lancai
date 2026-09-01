import { describe, expect, it } from "vitest";
import { criarAssistenteTeste, estadoComDefaults, IDS } from "./helpers-assistente";

describe("Critical Conversations E2E", () => {
  it("Criar + confirmar", async () => {
    const { core, repo } = criarAssistenteTeste();
    const s = await repo.create(IDS.user, estadoComDefaults());
    const r1 = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Gastei 50 no Uber no Nubank",
      sessaoId: s.id,
      canal: "web",
    });
    expect(r1.diagnostico?.executed).toBe(true);
    expect(r1.diagnostico?.war).toBeNull();
    expect(r1.resposta.toLowerCase()).toMatch(/lançad|uber/i);
  });

  it("Criar + corrigir data (foi ontem)", async () => {
    const { core, repo } = criarAssistenteTeste();
    const s = await repo.create(IDS.user, estadoComDefaults());
    const criado = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Gastei 50 no Uber no Nubank",
      sessaoId: s.id,
      canal: "web",
    });
    expect(criado.diagnostico?.executed).toBe(true);
    const r3 = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Foi ontem",
      sessaoId: s.id,
      canal: "web",
    });
    expect(r3.diagnostico?.op).toBe("update");
    expect(r3.diagnostico?.confirm || r3.diagnostico?.executed).toBeTruthy();
  });

  it("Consulta + referência posicional pede confirmação de update", async () => {
    const { core, repo, movimentos } = criarAssistenteTeste();
    const s = await repo.create(IDS.user, estadoComDefaults());
    const ids = [
      "00000000-0000-4000-8000-000000000111",
      "00000000-0000-4000-8000-000000000112",
      "00000000-0000-4000-8000-000000000113",
    ];
    ids.forEach((id, i) =>
      movimentos.set(id, {
        id,
        type: "transaction",
        label: `Uber ${i + 1}`,
        metadata: { merchant: "Uber", valor: 10 + i },
      }),
    );
    await core.processar({
      usuarioId: IDS.user,
      mensagem: "Quanto gastei com Uber?",
      sessaoId: s.id,
      canal: "web",
    });
    const r2 = await core.processar({
      usuarioId: IDS.user,
      mensagem: "O segundo foi pessoal",
      sessaoId: s.id,
      canal: "web",
    });
    expect(r2.diagnostico?.op).toBe("update");
    expect(r2.diagnostico?.confirm || r2.diagnostico?.executed).toBeTruthy();
  });

  it("Ambiguidade → pergunta numerada", async () => {
    const { core, repo, movimentos } = criarAssistenteTeste();
    const s = await repo.create(IDS.user, estadoComDefaults());
    for (const [i, id] of [
      "00000000-0000-4000-8000-000000000121",
      "00000000-0000-4000-8000-000000000122",
      "00000000-0000-4000-8000-000000000123",
    ].entries()) {
      movimentos.set(id, {
        id,
        type: "transaction",
        label: `Uber ${i + 1}`,
        metadata: { merchant: "Uber", valor: 40 + i, dataMovimento: `2026-08-2${i}` },
      });
    }
    const r = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Corrige o Uber",
      sessaoId: s.id,
      canal: "web",
    });
    expect(r.diagnostico?.clarification || r.resposta.includes("1.")).toBeTruthy();
  });

  it("Open Finance proteção", async () => {
    const ofId = "00000000-0000-4000-8000-000000000131";
    const { core, repo } = criarAssistenteTeste({
      ofTarget: {
        id: ofId,
        type: "transaction",
        label: "Tarifa banco",
        metadata: { fatoImutavel: true, fonte: "open_finance" },
      },
    });
    const s = await repo.create(IDS.user, {
      ...estadoComDefaults(),
      currentEntity: {
        id: ofId,
        type: "transaction",
        label: "Tarifa banco",
        metadata: { fatoImutavel: true, fonte: "open_finance" },
      },
    });
    const r = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Apaga aquele lançamento do banco",
      sessaoId: s.id,
      canal: "web",
    });
    expect(r.diagnostico?.blocked).toBe(true);
    expect(r.resposta.toLowerCase()).toMatch(/banco/);
  });

  it("Mensagem duplicada WA", async () => {
    const { core, repo } = criarAssistenteTeste();
    await repo.create(IDS.user, estadoComDefaults());
    const a = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Gastei 50 no Uber no Nubank",
      canal: "whatsapp",
      messageId: "msg-1",
    });
    const b = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Gastei 50 no Uber no Nubank",
      canal: "whatsapp",
      messageId: "msg-1",
    });
    expect(a.sessaoId).toBe(b.sessaoId);
    expect(b.duplicata).toBe(true);
    expect(b.resposta).toMatch(/já processei/i);
  });
});

describe("Wrong Action Rate", () => {
  it("WAR = 0: create lança na hora sem sim", async () => {
    const { core, repo, movimentos } = criarAssistenteTeste();
    const s = await repo.create(IDS.user, estadoComDefaults());
    const r = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Gastei 50 no Uber no Nubank",
      sessaoId: s.id,
      canal: "web",
    });
    expect(r.diagnostico?.executed).toBe(true);
    expect(r.diagnostico?.war).toBeNull();
    expect(movimentos.size).toBeGreaterThan(0);
  });

  it("WAR = 0 depois do create: write não é flagged", async () => {
    const { core, repo } = criarAssistenteTeste();
    const s = await repo.create(IDS.user, estadoComDefaults());
    const r = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Gastei 50 no Uber no Nubank",
      sessaoId: s.id,
      canal: "web",
    });
    expect(r.diagnostico?.executed).toBe(true);
    expect(r.diagnostico?.war).toBeNull();
  });
});
