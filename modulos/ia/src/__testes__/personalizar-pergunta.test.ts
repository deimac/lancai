import { describe, expect, it } from "vitest";
import {
  personalizar_pergunta,
  perguntar_campo,
  primeiro_nome,
} from "../personalizar-pergunta";

describe("personalizar_pergunta", () => {
  it("usa só o primeiro nome", () => {
    expect(primeiro_nome("Deividy Silva")).toBe("Deividy");
  });

  it("prefixa a pergunta", () => {
    expect(personalizar_pergunta("Qual é o valor?", "Deividy Silva")).toBe(
      "Deividy, qual é o valor?",
    );
  });

  it("não duplica o nome", () => {
    expect(personalizar_pergunta("Deividy, qual é o valor?", "Deividy")).toBe(
      "Deividy, qual é o valor?",
    );
  });

  it("mantém pergunta sem nome", () => {
    expect(personalizar_pergunta("Qual é o valor?", null)).toBe("Qual é o valor?");
  });

  it("pergunta curta com nome", () => {
    expect(perguntar_campo("Qual é o valor?", "Deividy")).toBe("Deividy, qual é o valor?");
    expect(perguntar_campo("Em qual conta ou cartão?", "Deividy")).toBe(
      "Deividy, em qual conta ou cartão?",
    );
  });
});
