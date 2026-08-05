import { describe, expect, it } from "vitest";
import { montar_prompt_sistema, montar_prompt_usuario, type ContextoInterpretacao } from "../prompt";

function contexto(parcial: Partial<ContextoInterpretacao> = {}): ContextoInterpretacao {
  return {
    dataAtual: "2026-08-05",
    contas: [{ nome: "Nubank", perfil: "pf" }],
    cartoes: [{ nome: "Azul Itaú", perfil: "pf", modalidade: "credito", temConta: false }],
    categorias: [
      { nome: "Transporte", tipo: "despesa" },
      { nome: "Alimentação", tipo: "despesa" },
    ],
    pessoas: [],
    habitos: [],
    historicoRecente: [],
    intencaoPendente: null,
    ...parcial,
  };
}

describe("prompt compacto (limite Groq TPM)", () => {
  it("system prompt fica bem abaixo do teto de 8k tokens", () => {
    const sistema = montar_prompt_sistema();
    // ~4 chars/token — 8k tokens ≈ 32k chars; queremos folga grande pro schema JSON.
    expect(sistema.length).toBeLessThan(3500);
  });

  it("trunca histórico longo e compacta contexto", () => {
    const longo = "Lançamentos de 05/08/2026 (2):\n" + "x".repeat(500);
    const prompt = montar_prompt_usuario("Quanto gastei esse mês?", contexto({
      historicoRecente: [
        { papel: "sistema", conteudo: longo },
        { papel: "usuario", conteudo: "Quanto gastei esse mês?" },
      ],
    }));
    expect(prompt).toContain("Nubank|pf");
    expect(prompt).toContain("S: ");
    expect(prompt).not.toContain("x".repeat(200));
    expect(prompt.length).toBeLessThan(1200);
  });
});
