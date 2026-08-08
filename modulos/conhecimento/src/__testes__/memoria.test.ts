import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { Memoria } from "../memoria/memoria";
import { RepositorioMemoriaEmMemoria } from "../memoria/repositorio-em-memoria";

describe("Memoria", () => {
  let repositorio: RepositorioMemoriaEmMemoria;
  let memoria: Memoria;
  let usuarioId: string;

  beforeEach(() => {
    repositorio = new RepositorioMemoriaEmMemoria();
    memoria = new Memoria(repositorio);
    usuarioId = randomUUID();
  });

  it("retorna undefined para um hábito ainda não aprendido", async () => {
    expect(await memoria.buscar_habito(usuarioId, "cartao_principal")).toBeUndefined();
  });

  it("salva e recupera um hábito", async () => {
    await memoria.salvar_habito(usuarioId, "cartao_principal", "Nubank");

    expect(await memoria.buscar_habito(usuarioId, "cartao_principal")).toBe("Nubank");
  });

  it("sobrescreve um hábito já existente", async () => {
    await memoria.salvar_habito(usuarioId, "cartao_principal", "Nubank");
    await memoria.salvar_habito(usuarioId, "cartao_principal", "Inter");

    expect(await memoria.buscar_habito(usuarioId, "cartao_principal")).toBe("Inter");
  });

  it("lista apenas os hábitos do usuário informado", async () => {
    const outroUsuarioId = randomUUID();
    await memoria.salvar_habito(usuarioId, "cartao_principal", "Nubank");
    await memoria.salvar_habito(outroUsuarioId, "cartao_principal", "Itaú");

    const habitos = await memoria.buscar_habitos(usuarioId);
    expect(habitos).toEqual([{ chave: "cartao_principal", valor: "Nubank" }]);
  });
});
