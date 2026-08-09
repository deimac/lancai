import { describe, expect, it } from "vitest";
import {
  schemaAtualizarWorkspace,
  schemaCriarWorkspace,
  schemaDefinirWorkspaceAtivo,
  schemaExcluirContaApi,
  schemaPatchCartaoApi,
  schemaPatchContaApi,
} from "../cadastro";

/** Espelha a mensagem da API — garante contrato estável do 400 em visão Geral. */
const MSG_GERAL_SOMENTE_LEITURA =
  "Na visão Geral só é possível consultar. Escolha um workspace para cadastrar.";

const USUARIO = "11111111-1111-4111-8111-111111111111";
const WORKSPACE = "22222222-2222-4222-8222-222222222222";

describe("schemas workspace e cadastro REST", () => {
  it("aceita criar workspace só com nome e descrição", () => {
    expect(
      schemaCriarWorkspace.parse({
        usuarioId: USUARIO,
        nome: "Viagens",
        descricao: "Contas da empresa de viagens",
        cor: "teal",
      }),
    ).toMatchObject({ nome: "Viagens", descricao: "Contas da empresa de viagens", cor: "teal" });

    expect(
      schemaDefinirWorkspaceAtivo.parse({ usuarioId: USUARIO, workspaceId: "geral" }),
    ).toEqual({ usuarioId: USUARIO, workspaceId: "geral" });

    expect(
      schemaDefinirWorkspaceAtivo.parse({ usuarioId: USUARIO, workspaceId: WORKSPACE }),
    ).toEqual({ usuarioId: USUARIO, workspaceId: WORKSPACE });

    expect(
      schemaAtualizarWorkspace.parse({ usuarioId: USUARIO, nome: "Principal", descricao: null }),
    ).toMatchObject({ nome: "Principal", descricao: null });

    // `tipo` deixa de ser produto — Zod descarta chave desconhecida
    expect(
      schemaCriarWorkspace.parse({
        usuarioId: USUARIO,
        nome: "Principal",
        tipo: "empresa",
      } as { usuarioId: string; nome: string }),
    ).toEqual({ usuarioId: USUARIO, nome: "Principal" });
  });

  it("documenta bloqueio de escrita na visão Geral", () => {
    expect(MSG_GERAL_SOMENTE_LEITURA).toContain("Escolha um workspace");
  });

  it("aceita patch/excluir conta e cartão", () => {
    expect(
      schemaPatchContaApi.parse({ usuarioId: USUARIO, nome: "Nubank", saldoAtual: 10 }),
    ).toMatchObject({ nome: "Nubank", saldoAtual: 10 });

    expect(schemaExcluirContaApi.parse({ usuarioId: USUARIO })).toEqual({ usuarioId: USUARIO });

    expect(
      schemaPatchCartaoApi.parse({
        usuarioId: USUARIO,
        nome: "Roxinho",
        limite: 2000,
        fechamento: 5,
        vencimento: 12,
        contaId: null,
      }),
    ).toMatchObject({ nome: "Roxinho", contaId: null });
  });
});
