import { describe, expect, it } from "vitest";
import { ConversationContextSchema, ConversationUnderstandingSchema, type QueryState } from "@lancai/tipos";
import { documentoMistoDeContextoV3 } from "../agente/documento-misto";
import {
  AGORA,
  MOVIMENTO_UBER,
  MOVIMENTO_UBER_B,
  contextoListaTresUbers,
  contextoAposConsultaUber,
} from "./casos-understanding";
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

  it("pagamento de fatura no Revolut pede sim e grava crédito no cartão", async () => {
    const { core } = criarAssistenteCoreV3Teste({
      acts: {
        "Lance um pagamento de fatura para o cartao revolut no valor de 1158,55 dia 17 de agosto": {
          act: "write",
          intent: {
            papel: "pagamento_fatura",
            valor: 1158.55,
            cartaoNome: "Revolut",
            data: "2026-08-17",
          },
        },
      },
    });
    const r1 = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Lance um pagamento de fatura para o cartao revolut no valor de 1158,55 dia 17 de agosto",
      canal: "web",
    });
    expect(r1.diagnostico?.confirm).toBe(true);
    expect(r1.resposta.toLowerCase()).toMatch(/ainda não gravei|responda sim/);

    const r2 = await core.processar({
      usuarioId: IDS.user,
      mensagem: "sim, pode",
      sessaoId: r1.sessaoId,
      canal: "web",
    });
    expect(r2.diagnostico?.executed).toBe(true);
    expect(r2.resposta.toLowerCase()).toMatch(/lançad/);
  });

  it("golden Lance pagamento no Revolut manual pede confirmação de criar", async () => {
    const { core } = criarAssistenteCoreV3Teste();
    const r1 = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Lance um pagamento de fatura para o cartão Revolut de 1158,55 no dia 17 de agosto",
      canal: "web",
    });
    expect(r1.diagnostico?.confirm).toBe(true);
    expect(r1.diagnostico?.blocked).toBeFalsy();
  });

  it("pagamento de fatura no cartão sincronizado recusa criar", async () => {
    const { core, movimentos } = criarAssistenteCoreV3Teste({
      acts: {
        "Quita o Azul, 2000, ontem": {
          act: "write",
          intent: {
            papel: "pagamento_fatura",
            valor: 2000,
            cartaoNome: "Azul",
            data: "2026-08-22",
          },
        },
      },
    });
    const antes = movimentos.size;
    const r = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Quita o Azul, 2000, ontem",
      canal: "web",
    });
    expect(r.diagnostico?.blocked).toBe(true);
    expect(r.diagnostico?.confirm).toBeFalsy();
    expect(r.resposta).toMatch(/conectada ao banco/i);
    expect(r.resposta).toMatch(/classifico/i);
    expect(movimentos.size).toBe(antes);
  });

  it("pagamento de fatura saindo de conta sincronizada recusa criar", async () => {
    const { core, movimentos } = criarAssistenteCoreV3Teste({
      acts: {
        "Paguei o Revolut 200 saindo da Nubank": {
          act: "write",
          intent: {
            papel: "pagamento_fatura",
            valor: 200,
            cartaoNome: "Revolut",
            contaNome: "Nubank",
          },
        },
      },
    });
    const antes = movimentos.size;
    const r = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Paguei o Revolut 200 saindo da Nubank",
      canal: "web",
    });
    expect(r.diagnostico?.blocked).toBe(true);
    expect(r.diagnostico?.confirm).toBeFalsy();
    expect(r.resposta).toMatch(/Nubank/);
    expect(r.resposta).toMatch(/conectada ao banco/i);
    expect(movimentos.size).toBe(antes);
  });

  it("compra no Revolut não é tratada como pagamento de fatura", async () => {
    const { core } = criarAssistenteCoreV3Teste();
    const r1 = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Gastei 50 no Uber no Revolut",
      canal: "web",
    });
    expect(r1.diagnostico?.confirm).toBe(true);
    expect(r1.resposta.toLowerCase()).toMatch(/uber/);
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
    expect(r.resposta).toMatch(/Xai/);
    expect(r.diagnostico?.executed).toBeFalsy();
  });

  it("greet inclui o primeiro nome quando informado", async () => {
    const { core } = criarAssistenteCoreV3Teste();
    const r = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Oi, tudo bem?",
      canal: "web",
      primeiroNome: "Ana",
    });
    expect(r.resposta).toMatch(/Olá, Ana/);
    expect(r.resposta).toMatch(/Xai/);
  });

  it("delete do 1 ao 2 pede uma confirmação para o conjunto", async () => {
    const { core, repo } = criarAssistenteCoreV3Teste({
      acts: {
        "cancela do 1 ao 2": {
          act: "delete",
          target: { by: "ordinal_range", de: 1, ate: 2 },
        },
      },
    });
    const ctx = ConversationContextSchema.parse({
      ...contextoListaTresUbers(),
      result: {
        queryHash: "q",
        generatedAt: AGORA,
        stale: false,
        summary: { count: 2 },
        rows: [
          {
            ordinal: 1,
            entityType: "transaction",
            entityId: MOVIMENTO_UBER,
            label: "Uber A",
            amount: 42,
          },
          {
            ordinal: 2,
            entityType: "transaction",
            entityId: MOVIMENTO_UBER_B,
            label: "Uber B",
            amount: 50,
          },
        ],
      },
    });
    const doc = await repo.createDocumento(IDS.user, documentoMistoDeContextoV3(ctx));
    const r = await core.processar({
      usuarioId: IDS.user,
      mensagem: "cancela do 1 ao 2",
      sessaoId: doc.id,
      canal: "web",
    });
    expect(r.diagnostico?.confirm).toBe(true);
    expect(r.resposta).toMatch(/2 lançamentos/i);
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

  it("origemPerfil=pj sobrevive a detalhado e a patch de período", async () => {
    const { core, repo } = criarAssistenteCoreV3Teste({
      extra: {
        "saídas da conta da empresa ontem": ConversationUnderstandingSchema.parse({
          goal: "answer",
          question: {
            intent: "total",
            entities: { metric: "sum", period: { tipo: "personalizado", de: "2026-08-22", ate: "2026-08-22" } },
            implicit_filters: { tipo: "despesa", origemPerfil: "pj" },
          },
          confidence: 0.9,
          required_sources: ["transactions"],
        }),
        "mostre detalhado": ConversationUnderstandingSchema.parse({
          goal: "continue",
          continuation: {
            type: "detail_request",
            reference: { type: "anaphoric", pronoun: "that" },
            inherits_from_previous: true,
          },
          confidence: 0.9,
          required_sources: ["transactions"],
        }),
        "e no sábado?": ConversationUnderstandingSchema.parse({
          goal: "continue",
          continuation: {
            type: "period_shift",
            reference: { type: "temporal", relative: "saturday" },
            inherits_from_previous: true,
          },
          confidence: 0.9,
          required_sources: ["transactions"],
        }),
      },
    });

    const r1 = await core.processar({
      usuarioId: IDS.user,
      mensagem: "saídas da conta da empresa ontem",
      canal: "web",
    });
    expect(r1.diagnostico?.op).toBe("query");
    const doc1 = await repo.getDocumento(r1.sessaoId);
    expect(doc1?.documento.query).toMatchObject({ origemPerfil: "pj", grain: "summary" });

    const r2 = await core.processar({
      usuarioId: IDS.user,
      mensagem: "mostre detalhado",
      sessaoId: r1.sessaoId,
      canal: "web",
    });
    expect(r2.diagnostico?.executed).toBe(true);
    const doc2 = await repo.getDocumento(r2.sessaoId);
    expect(doc2?.documento.query).toMatchObject({ origemPerfil: "pj", grain: "list" });

    const r3 = await core.processar({
      usuarioId: IDS.user,
      mensagem: "e no sábado?",
      sessaoId: r2.sessaoId,
      canal: "web",
    });
    expect(r3.diagnostico?.op).toBe("query");
    expect(r3.diagnostico?.executed).toBe(true);
    const doc3 = await repo.getDocumento(r3.sessaoId);
    expect(doc3?.documento.query).toMatchObject({
      origemPerfil: "pj",
      grain: "list",
      period: { tipo: "personalizado", de: "2026-08-22", ate: "2026-08-22" },
    });
  });

  it("e hoje qual foi a maior entrada? vira grain top de receita, não soma", async () => {
    const { core, repo } = criarAssistenteCoreV3Teste({
      acts: {
        "saídas da conta da empresa ontem": {
          act: "new_query",
          query: {
            grain: "summary",
            tipos: ["despesa"],
            origemPerfil: "pj",
            period: { tipo: "personalizado", de: "2026-08-22", ate: "2026-08-22" },
          },
        },
        "e hoje qual foi a maior entrada?": {
          act: "patch_query",
          ops: [
            { op: "set", slot: "period", value: { tipo: "personalizado", de: "2026-08-23", ate: "2026-08-23" } },
            { op: "set", slot: "tipos", value: ["receita"] },
            { op: "set", slot: "grain", value: "top" },
            { op: "set", slot: "sort", value: { by: "valor", dir: "desc" } },
            { op: "set", slot: "limit", value: 1 },
          ],
        },
      },
    });

    const r1 = await core.processar({
      usuarioId: IDS.user,
      mensagem: "saídas da conta da empresa ontem",
      canal: "web",
    });
    expect(r1.diagnostico?.op).toBe("query");

    const r2 = await core.processar({
      usuarioId: IDS.user,
      mensagem: "e hoje qual foi a maior entrada?",
      sessaoId: r1.sessaoId,
      canal: "web",
    });
    expect(r2.diagnostico?.op).toBe("query");
    expect(r2.diagnostico?.executed).toBe(true);
    const doc = await repo.getDocumento(r2.sessaoId);
    expect(doc?.documento.query).toMatchObject({
      origemPerfil: "pj",
      tipos: ["receita"],
      grain: "top",
      limit: 1,
      sort: { by: "valor", dir: "desc" },
    });
  });

  it("os 3 últimos de hoje persistem grain list com limit 3", async () => {
    const { core, repo } = criarAssistenteCoreV3Teste({
      acts: {
        "me mostre os 3 últimos lançamentos de hoje": {
          act: "new_query",
          query: {
            grain: "list",
            period: { tipo: "personalizado", de: "2026-08-23", ate: "2026-08-23" },
            sort: { by: "data", dir: "desc" },
            limit: 3,
          },
        },
      },
    });
    const r = await core.processar({
      usuarioId: IDS.user,
      mensagem: "me mostre os 3 últimos lançamentos de hoje",
      canal: "web",
    });
    expect(r.diagnostico?.op).toBe("query");
    const doc = await repo.getDocumento(r.sessaoId);
    const query = doc?.documento.query as QueryState | undefined;
    expect(query).toMatchObject({
      grain: "list",
      limit: 3,
      sort: { by: "data", dir: "desc" },
    });
    expect(query?.tipos).toBeUndefined();
  });

  it("resultado de hoje é summary sem tipos (entradas menos saídas)", async () => {
    const { core, repo } = criarAssistenteCoreV3Teste({
      acts: {
        "saídas da conta da empresa ontem": {
          act: "new_query",
          query: {
            grain: "summary",
            tipos: ["despesa"],
            origemPerfil: "pj",
            period: { tipo: "personalizado", de: "2026-08-22", ate: "2026-08-22" },
          },
        },
        "qual o resultado de hoje?": {
          act: "patch_query",
          ops: [
            { op: "set", slot: "period", value: { tipo: "personalizado", de: "2026-08-23", ate: "2026-08-23" } },
            { op: "set", slot: "grain", value: "summary" },
            { op: "clear", slot: "tipos" },
          ],
        },
      },
    });
    const r1 = await core.processar({
      usuarioId: IDS.user,
      mensagem: "saídas da conta da empresa ontem",
      canal: "web",
    });
    const r2 = await core.processar({
      usuarioId: IDS.user,
      mensagem: "qual o resultado de hoje?",
      sessaoId: r1.sessaoId,
      canal: "web",
    });
    expect(r2.diagnostico?.executed).toBe(true);
    const doc = await repo.getDocumento(r2.sessaoId);
    const query = doc?.documento.query as QueryState | undefined;
    expect(query).toMatchObject({
      origemPerfil: "pj",
      grain: "summary",
      period: { tipo: "personalizado", de: "2026-08-23", ate: "2026-08-23" },
    });
    expect(query?.tipos).toBeUndefined();
  });

  it("detalhado depois do maior limpa sort e limit", async () => {
    const { core, repo } = criarAssistenteCoreV3Teste({
      acts: {
        "qual foi a maior entrada?": {
          act: "new_query",
          query: {
            grain: "top",
            tipos: ["receita"],
            sort: { by: "valor", dir: "desc" },
            limit: 1,
            period: { tipo: "personalizado", de: "2026-08-23", ate: "2026-08-23" },
          },
        },
        "mostre detalhado": { act: "change_grain", grain: "list" },
      },
    });
    const r1 = await core.processar({
      usuarioId: IDS.user,
      mensagem: "qual foi a maior entrada?",
      canal: "web",
    });
    const r2 = await core.processar({
      usuarioId: IDS.user,
      mensagem: "mostre detalhado",
      sessaoId: r1.sessaoId,
      canal: "web",
    });
    expect(r2.diagnostico?.executed).toBe(true);
    const doc = await repo.getDocumento(r2.sessaoId);
    const query = doc?.documento.query as QueryState | undefined;
    expect(query?.grain).toBe("list");
    expect(query?.sort).toBeUndefined();
    expect(query?.limit).toBeUndefined();
    expect(query?.tipos).toEqual(["receita"]);
  });

  it("quanto a tayna me enviou de pix? soma receita pelo nome e não inventa o mês", async () => {
    const { core, repo } = criarAssistenteCoreV3Teste({
      dataAtual: "2026-08-25",
      acts: {
        "quanto a tayna santos me enviou de pix?": {
          act: "new_query",
          query: {
            grain: "summary",
            tipos: ["despesa"],
            merchant: "pix",
            period: { tipo: "mes_atual" },
          },
        },
      },
    });
    const r = await core.processar({
      usuarioId: IDS.user,
      mensagem: "quanto a tayna santos me enviou de pix?",
      canal: "web",
    });
    expect(r.diagnostico?.executed).toBe(true);
    const doc = await repo.getDocumento(r.sessaoId);
    expect(doc?.documento.query).toMatchObject({
      grain: "summary",
      tipos: ["receita"],
      merchant: "tayna santos",
    });
    expect((doc?.documento.query as QueryState | undefined)?.period).toBeUndefined();
  });

  it("quanto recebi de pix da Tayna? busca o nome, não a frase com pix", async () => {
    const { core, repo } = criarAssistenteCoreV3Teste({
      dataAtual: "2026-08-25",
      acts: {
        "quanto recebi de pix da Tayna Santos?": {
          act: "new_query",
          query: {
            grain: "summary",
            tipos: ["receita"],
            merchant: "pix da Tayna Santos",
            period: { tipo: "mes_atual" },
          },
        },
      },
    });
    const r = await core.processar({
      usuarioId: IDS.user,
      mensagem: "quanto recebi de pix da Tayna Santos?",
      canal: "web",
    });
    expect(r.diagnostico?.executed).toBe(true);
    const doc = await repo.getDocumento(r.sessaoId);
    expect(doc?.documento.query).toMatchObject({
      grain: "summary",
      tipos: ["receita"],
      merchant: "Tayna Santos",
    });
    expect((doc?.documento.query as QueryState | undefined)?.period).toBeUndefined();
  });

  it("conta da empresa não pede slot de conta chamada empresa", async () => {
    const { core, repo } = criarAssistenteCoreV3Teste({
      dataAtual: "2026-08-25",
      acts: {
        "quanto gastei na conta da empresa este mês?": {
          act: "new_query",
          query: {
            grain: "summary",
            tipos: ["despesa"],
            period: { tipo: "mes_atual" },
          },
          names: { contaNome: "empresa" },
        },
      },
    });
    const r = await core.processar({
      usuarioId: IDS.user,
      mensagem: "quanto gastei na conta da empresa este mês?",
      canal: "web",
    });
    expect(r.resposta).not.toMatch(/Não encontrei a conta empresa/i);
    expect(r.diagnostico?.executed).toBe(true);
    const doc = await repo.getDocumento(r.sessaoId);
    expect(doc?.documento.query).toMatchObject({ origemPerfil: "pj", tipos: ["despesa"] });
  });

  it("e sábado eu tive entradas? depois de ontem troca o período e mantém receita", async () => {
    const { core, repo } = criarAssistenteCoreV3Teste({
      dataAtual: "2026-08-25",
      acts: {
        "quanto tive de entradas ontem?": {
          act: "new_query",
          query: {
            grain: "summary",
            tipos: ["receita"],
            period: { tipo: "personalizado", de: "2026-08-24", ate: "2026-08-24" },
          },
        },
        "e sabado eu tive entradas?": {
          act: "patch_query",
          ops: [
            { op: "set", slot: "period", value: { tipo: "personalizado", de: "<sábado>", ate: "<sábado>" } },
          ],
        },
      },
    });
    const r1 = await core.processar({
      usuarioId: IDS.user,
      mensagem: "quanto tive de entradas ontem?",
      canal: "web",
    });
    expect(r1.diagnostico?.op).toBe("query");
    const r2 = await core.processar({
      usuarioId: IDS.user,
      mensagem: "e sabado eu tive entradas?",
      sessaoId: r1.sessaoId,
      canal: "web",
    });
    expect(r2.resposta).not.toMatch(/dados inválidos/i);
    expect(r2.diagnostico?.executed).toBe(true);
    const doc = await repo.getDocumento(r2.sessaoId);
    expect(doc?.documento.query).toMatchObject({
      tipos: ["receita"],
      grain: "summary",
      period: { tipo: "personalizado", de: "2026-08-22", ate: "2026-08-22" },
    });
  });

  it("write só com DialogueAct pede confirmação e executa no sim", async () => {
    const { core } = criarAssistenteCoreV3Teste({
      acts: {
        "Gastei 50 no Uber no Nubank": {
          act: "write",
          intent: { tipo: "despesa", valor: 50, descricao: "Uber", contaNome: "Nubank" },
        },
        sim: { act: "confirm" },
      },
    });
    const r1 = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Gastei 50 no Uber no Nubank",
      canal: "web",
    });
    expect(r1.diagnostico?.confirm).toBe(true);
    const r2 = await core.processar({
      usuarioId: IDS.user,
      mensagem: "sim",
      sessaoId: r1.sessaoId,
      canal: "web",
    });
    expect(r2.diagnostico?.executed).toBe(true);
    expect(r2.resposta.toLowerCase()).toMatch(/lançad|uber/);
  });

  it("update só com DialogueAct corrige valor do foco", async () => {
    const { core, repo } = criarAssistenteCoreV3Teste({
      acts: {
        "Foi 580": {
          act: "update",
          patch: { valor: 580 },
        },
      },
    });
    const ctx = {
      ...contextoAposConsultaUber(),
      focused_entity: {
        id: MOVIMENTO_UBER,
        type: "transaction" as const,
        label: "Uber",
        metadata: { merchant: "Uber", valor: 850, dataMovimento: "2026-08-22" },
      },
    };
    const doc = await repo.createDocumento(IDS.user, documentoMistoDeContextoV3(ctx));
    const r = await core.processar({
      usuarioId: IDS.user,
      mensagem: "Foi 580",
      sessaoId: doc.id,
      canal: "web",
    });
    expect(r.diagnostico?.op).toBe("update");
    expect(r.diagnostico?.confirm || r.diagnostico?.executed).toBeTruthy();
  });
});
