import { describe, expect, it } from "vitest";
import { eh_atalho_menu, montar_resposta_menu } from "../montar-resposta-menu";

describe("eh_atalho_menu", () => {
  it.each(["menu", "Menu", "AJUDA", " ajuda ", "/menu", "/ajuda", "help"])(
    "reconhece '%s' como atalho de menu",
    (mensagem) => {
      expect(eh_atalho_menu(mensagem)).toBe(true);
    },
  );

  it.each(["Gastei R$ 45 no almoço hoje", "menu de opções", "ajudar"])(
    "não reconhece '%s' como atalho de menu",
    (mensagem) => {
      expect(eh_atalho_menu(mensagem)).toBe(false);
    },
  );
});

describe("montar_resposta_menu", () => {
  it("convida para o onboarding quando o usuário não tem contas", () => {
    const texto = montar_resposta_menu({ totalContas: 0, totalCartoes: 0 });
    expect(texto).toContain("Você ainda não tem nenhuma conta cadastrada");
  });

  it("mostra a contagem de contas e cartões quando o usuário já tem cadastro", () => {
    const texto = montar_resposta_menu({ totalContas: 2, totalCartoes: 1 });
    expect(texto).toContain("Você tem 2 conta(s) e 1 cartão(ões) cadastrados.");
  });

  it("sempre lista os principais comandos disponíveis", () => {
    const texto = montar_resposta_menu({ totalContas: 1, totalCartoes: 0 });
    expect(texto).toContain("Registrar receita ou despesa");
    expect(texto).toContain("Corrigir um lançamento");
    expect(texto).toContain("Cadastrar conta ou cartão");
  });
});
