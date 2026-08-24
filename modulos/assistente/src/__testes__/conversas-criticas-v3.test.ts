import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { documentoMistoDeContextoV3 } from "../agente/documento-misto";
import { CASOS_UNDERSTANDING, contextoAposConsultaUber } from "./casos-understanding";
import {
  criarAssistenteCoreV3Teste,
  IDS_V3,
  processarCasoV3,
} from "./helpers-assistente-v3";

type Esperado = {
  op?: string;
  confirm?: boolean;
  executed?: boolean;
  blocked?: boolean;
  clarification?: boolean;
  reason?: string;
};

const SUITE: Array<{ categoria: string; id: string; esperado: Esperado }> = [
  { categoria: "criação", id: "create-uber-nubank", esperado: { op: "create", confirm: true } },
  { categoria: "criação", id: "create-salario", esperado: { op: "create", confirm: true } },
  { categoria: "criação", id: "create-transferencia", esperado: { op: "create", confirm: true } },
  { categoria: "criação", id: "create-parcelado", esperado: { op: "create", confirm: true } },
  { categoria: "criação", id: "clarify-sem-conta", esperado: { clarification: true } },
  { categoria: "consulta", id: "consulta-total-uber", esperado: { op: "query", executed: true } },
  { categoria: "consulta", id: "consulta-lista-uber", esperado: { op: "query", executed: true } },
  { categoria: "consulta", id: "consulta-detalhe", esperado: { op: "query", executed: true } },
  { categoria: "consulta", id: "saldo-nubank", esperado: { op: "query", executed: true } },
  { categoria: "consulta", id: "receita-total", esperado: { op: "query", executed: true } },
  { categoria: "ref-posicional", id: "ref-posicional-primeiro", esperado: { op: "update", confirm: true } },
  { categoria: "ref-posicional", id: "ref-posicional-segundo", esperado: { op: "update", confirm: true } },
  { categoria: "ref-posicional", id: "ref-posicional-terceiro", esperado: { op: "update", confirm: true } },
  { categoria: "ref-temporal", id: "ref-temporal-ontem", esperado: { clarification: true } },
  { categoria: "ref-temporal", id: "correcao-foi-ontem", esperado: { op: "update", confirm: true } },
  { categoria: "ref-temporal", id: "period-shift-semana-personalizado", esperado: { op: "query", executed: true } },
  { categoria: "ref-merchant", id: "ref-merchant-uber", esperado: { op: "update", confirm: true } },
  { categoria: "ref-merchant", id: "ref-merchant-ifood", esperado: { op: "update", confirm: true } },
  { categoria: "ref-merchant", id: "ambiguidade-tres-ubers", esperado: { clarification: true } },
  { categoria: "ref-anaforica", id: "ref-anaforica", esperado: { op: "update", confirm: true } },
  { categoria: "ref-anaforica", id: "ref-anaforica-anterior", esperado: { op: "update", confirm: true } },
  { categoria: "correcao-conhecimento", id: "correcao-conta-conhecimento", esperado: { clarification: true } },
  { categoria: "cancelamento", id: "cancelar-manual", esperado: { op: "delete", confirm: true } },
  { categoria: "cancelamento", id: "of-delete", esperado: { blocked: true, reason: "of_cannot_delete" } },
  { categoria: "ambiguidade", id: "ambiguidade-dois-ifoods", esperado: { clarification: true } },
  { categoria: "open-finance", id: "of-update-fato", esperado: { blocked: true, reason: "of_fato_immutable" } },
  { categoria: "open-finance", id: "of-conhecimento-permitido", esperado: { op: "update", confirm: true } },
  { categoria: "computacao", id: "compare-mes-passado", esperado: { op: "query", executed: true } },
  { categoria: "computacao", id: "breakdown-categoria", esperado: { op: "query", executed: true } },
  { categoria: "computacao", id: "trend", esperado: { op: "query", executed: true } },
  { categoria: "continuidade", id: "continue-period-shift", esperado: { op: "query", executed: true } },
  { categoria: "continuidade", id: "continue-filter-add-cartao", esperado: { op: "query", executed: true } },
  { categoria: "continuidade", id: "continue-filter-remove-merchant", esperado: { op: "query", executed: true } },
  { categoria: "continuidade", id: "continue-detail-request", esperado: { op: "query", executed: true } },
  { categoria: "continuidade", id: "mudanca-assunto-ifood", esperado: { op: "query", executed: true } },
];

describe("35 conversas críticas (Core V3, extractor mockado)", () => {
  it(`tem ${SUITE.length} casos (≥ 35)`, () => {
    expect(SUITE.length).toBeGreaterThanOrEqual(35);
    const ids = new Set(SUITE.map((c) => c.id));
    expect(ids.size).toBe(SUITE.length);
    for (const item of SUITE) {
      expect(CASOS_UNDERSTANDING.some((c) => c.id === item.id)).toBe(true);
    }
  });

  it.each(SUITE.map((c) => [c.categoria, c.id, c.esperado] as const))(
    "%s / %s",
    async (_categoria, id, esperado) => {
      const { saida } = await processarCasoV3(id);
      if (esperado.op) expect(saida.diagnostico?.op).toBe(esperado.op);
      if (esperado.confirm) expect(saida.diagnostico?.confirm).toBe(true);
      if (esperado.executed) expect(saida.diagnostico?.executed).toBe(true);
      if (esperado.blocked) expect(saida.diagnostico?.blocked).toBe(true);
      if (esperado.clarification) expect(saida.diagnostico?.clarification).toBe(true);
      if (esperado.reason) expect(saida.diagnostico?.reason).toBe(esperado.reason);
      expect(saida.resposta.length).toBeGreaterThan(0);
    },
  );

  it("concorrência: web e WhatsApp na mesma sessão não perdem o CAS", async () => {
    const { core, repo } = criarAssistenteCoreV3Teste();
    const doc = await repo.createDocumento(IDS_V3.user, documentoMistoDeContextoV3(contextoAposConsultaUber()));
    const [web, wa] = await Promise.all([
      core.processar({
        usuarioId: IDS_V3.user,
        mensagem: "E mês passado?",
        sessaoId: doc.id,
        canal: "web",
      }),
      core.processar({
        usuarioId: IDS_V3.user,
        mensagem: "E o iFood?",
        sessaoId: doc.id,
        canal: "whatsapp",
        messageId: "wa-conc",
      }),
    ]);
    expect(web.diagnostico?.op).toBe("query");
    expect(wa.diagnostico?.op).toBe("query");
    expect(web.diagnostico?.executed).toBe(true);
    expect(wa.diagnostico?.executed).toBe(true);
  });
});

describe("política anti-atalho V3", () => {
  it("AssistenteCoreV3 não importa o SemanticParser v2", () => {
    const aqui = dirname(fileURLToPath(import.meta.url));
    const fonte = readFileSync(join(aqui, "../agente/assistente-core-v3.ts"), "utf8");
    expect(fonte).not.toMatch(/semantic-parser/i);
    expect(fonte).toContain("UnderstandingExtractor");
  });
});
