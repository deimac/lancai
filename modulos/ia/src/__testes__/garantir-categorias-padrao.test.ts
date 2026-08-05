import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CATEGORIAS_PADRAO } from "@lancai/banco";
import { garantir_categorias_padrao } from "../garantir-categorias-padrao";
import { RepositorioContextoEmMemoria } from "../repositorio-contexto-memoria";

describe("garantir_categorias_padrao", () => {
  it("cria todas as categorias padrão quando o usuário ainda não tem nenhuma", async () => {
    const repositorio = new RepositorioContextoEmMemoria();
    const usuarioId = randomUUID();

    const categorias = await garantir_categorias_padrao(usuarioId, repositorio);

    expect(categorias).toHaveLength(CATEGORIAS_PADRAO.length);
    expect(categorias.map((categoria) => categoria.nome).sort()).toEqual(
      CATEGORIAS_PADRAO.map((categoria) => categoria.nome).sort(),
    );
    expect(categorias.find((categoria) => categoria.nome === "Transporte")?.tipo).toBe("despesa");
    expect(categorias.find((categoria) => categoria.nome === "Outros")?.tipo).toBe("ambos");
  });

  it("é idempotente e não duplica nomes existentes (ignorando caixa)", async () => {
    const repositorio = new RepositorioContextoEmMemoria();
    const usuarioId = randomUUID();

    await repositorio.criarCategoria(usuarioId, "transporte", "despesa");
    await garantir_categorias_padrao(usuarioId, repositorio);
    const segunda = await garantir_categorias_padrao(usuarioId, repositorio);

    const transportes = segunda.filter(
      (categoria) => categoria.nome.toLocaleLowerCase("pt-BR") === "transporte",
    );
    expect(transportes).toHaveLength(1);
    expect(segunda).toHaveLength(CATEGORIAS_PADRAO.length);
  });
});
