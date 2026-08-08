import { describe, expect, it } from "vitest";
import {
  schemaAtualizarWorkspace,
  schemaCriarWorkspace,
  schemaDefinirWorkspaceAtivo,
  schemaExcluirContaApi,
  schemaPatchCartaoApi,
  schemaPatchContaApi,
} from "../cadastro";

const USUARIO = "11111111-1111-4111-8111-111111111111";
const WORKSPACE = "22222222-2222-4222-8222-222222222222";

describe("schemas workspace e cadastro REST", () => {
  it("aceita criar e ativar workspace", () => {
    expect(
      schemaCriarWorkspace.parse({ usuarioId: USUARIO, nome: "Empresa", tipo: "empresa" }),
    ).toMatchObject({ nome: "Empresa", tipo: "empresa" });

    expect(
      schemaDefinirWorkspaceAtivo.parse({ usuarioId: USUARIO, workspaceId: WORKSPACE }),
    ).toEqual({ usuarioId: USUARIO, workspaceId: WORKSPACE });

    expect(
      schemaAtualizarWorkspace.parse({ usuarioId: USUARIO, nome: "Pessoal 2" }),
    ).toMatchObject({ nome: "Pessoal 2" });
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
