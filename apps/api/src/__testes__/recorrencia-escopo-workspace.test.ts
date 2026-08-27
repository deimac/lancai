import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => {
  const wsA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
  const wsB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
  const usuarioId = "11111111-1111-4111-8111-111111111111";

  type Linha = {
    id: string;
    usuarioId: string;
    workspaceId: string;
    descricao: string;
    valor: string;
    tipo: "despesa";
    categoriaId: string;
    contaId: string | null;
    cartaoId: string | null;
    diaDoMes: number;
    origem: "cadastro";
    ativa: boolean;
  };

  const store = {
    wsA,
    wsB,
    usuarioId,
    escopo: {
      visaoAgregada: false,
      workspaceAtivoId: wsA,
      workspaceIds: [wsA] as string[],
    },
    linhas: [] as Linha[],
    inArrayValores: [] as unknown[][],
    ultimoSelect: [] as Linha[],
    semear(sobrepor: Partial<Linha> & { workspaceId: string; descricao: string }): Linha {
      const linha: Linha = {
        id: randomUUID(),
        usuarioId,
        valor: "55.90",
        tipo: "despesa",
        categoriaId: "cat",
        contaId: "conta-1",
        cartaoId: null,
        diaDoMes: 10,
        origem: "cadastro",
        ativa: true,
        ...sobrepor,
      };
      store.linhas.push(linha);
      return linha;
    },
  };

  return store;
});

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    inArray: ((coluna: Parameters<typeof actual.inArray>[0], valores: Parameters<typeof actual.inArray>[1]) => {
      estado.inArrayValores.push(Array.isArray(valores) ? valores : []);
      return actual.inArray(coluna, valores);
    }) as typeof actual.inArray,
  };
});

vi.mock("../servicos/escopo-workspace", () => ({
  obter_escopo_leitura: async () => estado.escopo,
  exigir_workspace_escrita: async () => estado.escopo.workspaceAtivoId,
}));

vi.mock("@lancai/banco", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lancai/banco")>();

  function ids_do_inarray(): string[] | undefined {
    const ultimo = estado.inArrayValores.at(-1);
    return Array.isArray(ultimo) ? (ultimo as string[]) : undefined;
  }

  function no_escopo() {
    const ids = ids_do_inarray();
    return estado.linhas.filter((linha) => !ids || ids.includes(linha.workspaceId));
  }

  function cadeia(obter: () => unknown) {
    const consulta = {
      from: () => consulta,
      where: () => consulta,
      limit: (n: number) =>
        cadeia(() => {
          const linhas = obter();
          return Array.isArray(linhas) ? linhas.slice(0, n) : linhas;
        }),
      set: (_valor: Record<string, unknown>) => consulta,
      values: (_valor: Record<string, unknown>) => consulta,
      returning: () => consulta,
      then: (resolve: (valor: unknown) => unknown, reject?: (erro: unknown) => unknown) =>
        Promise.resolve(obter()).then(resolve, reject),
    };
    return consulta;
  }

  return {
    ...actual,
    obter_banco: () => ({
      select: () =>
        cadeia(() => {
          estado.ultimoSelect = no_escopo();
          return estado.ultimoSelect;
        }),
      insert: () => {
        const consulta = cadeia(() => []);
        consulta.values = (valor: Record<string, unknown>) =>
          cadeia(() => {
            const linha = estado.semear({
              workspaceId: String(valor.workspaceId),
              descricao: String(valor.descricao),
              usuarioId: String(valor.usuarioId),
              valor: String(valor.valor),
              tipo: valor.tipo as "despesa",
              categoriaId: String(valor.categoriaId),
              contaId: (valor.contaId as string | null) ?? null,
              cartaoId: (valor.cartaoId as string | null) ?? null,
              diaDoMes: Number(valor.diaDoMes),
              origem: "cadastro",
              ativa: true,
            });
            return [linha];
          });
        return consulta;
      },
      update: () => {
        let patch: Record<string, unknown> = {};
        const consulta = cadeia(() => []);
        consulta.set = (valor: Record<string, unknown>) => {
          patch = valor;
          return consulta;
        };
        consulta.returning = () =>
          cadeia(() => {
            const alvo = estado.ultimoSelect[0];
            if (!alvo) return [];
            Object.assign(alvo, patch);
            return [alvo];
          });
        return consulta;
      },
    }),
  };
});

import {
  cancelar_recorrencia,
  criar_recorrencia,
  listar_recorrencias,
} from "../servicos/recorrencia-servico";

describe("recorrências seguem o workspace ativo", () => {
  beforeEach(() => {
    estado.linhas = [];
    estado.inArrayValores = [];
    estado.ultimoSelect = [];
    estado.escopo = {
      visaoAgregada: false,
      workspaceAtivoId: estado.wsA,
      workspaceIds: [estado.wsA],
    };
  });

  it("no workspace A não lista a recorrência do workspace B", async () => {
    estado.semear({ workspaceId: estado.wsB, descricao: "Netflix B" });
    estado.semear({ workspaceId: estado.wsA, descricao: "Netflix A" });

    const lista = await listar_recorrencias(estado.usuarioId);

    expect(estado.inArrayValores.at(-1)).toEqual([estado.wsA]);
    expect(lista.map((item) => item.descricao)).toEqual(["Netflix A"]);
  });

  it("visão Geral lista as recorrências dos dois workspaces", async () => {
    estado.semear({ workspaceId: estado.wsB, descricao: "Netflix B" });
    estado.semear({ workspaceId: estado.wsA, descricao: "Netflix A" });
    estado.escopo = {
      visaoAgregada: true,
      workspaceAtivoId: estado.wsA,
      workspaceIds: [estado.wsA, estado.wsB],
    };

    const lista = await listar_recorrencias(estado.usuarioId);

    expect(estado.inArrayValores.at(-1)).toEqual([estado.wsA, estado.wsB]);
    expect(lista.map((item) => item.descricao).sort()).toEqual(["Netflix A", "Netflix B"]);
  });

  it("sem workspace no escopo devolve lista vazia", async () => {
    estado.semear({ workspaceId: estado.wsA, descricao: "Netflix A" });
    estado.escopo = {
      visaoAgregada: false,
      workspaceAtivoId: estado.wsA,
      workspaceIds: [],
    };

    expect(await listar_recorrencias(estado.usuarioId)).toEqual([]);
    expect(estado.inArrayValores).toEqual([]);
  });

  it("cancelar no workspace A não desativa a Netflix do workspace B", async () => {
    const deB = estado.semear({ workspaceId: estado.wsB, descricao: "Netflix" });
    const deA = estado.semear({ workspaceId: estado.wsA, descricao: "Netflix" });

    const cancelada = await cancelar_recorrencia(estado.usuarioId, "Netflix");

    expect(cancelada?.id).toBe(deA.id);
    expect(deA.ativa).toBe(false);
    expect(deB.ativa).toBe(true);
  });

  it("cria no workspace concreto ativo", async () => {
    estado.escopo.workspaceAtivoId = estado.wsB;
    estado.escopo.workspaceIds = [estado.wsB];

    const criada = await criar_recorrencia({
      usuarioId: estado.usuarioId,
      descricao: "Spotify",
      valor: 21.9,
      diaDoMes: 5,
      tipo: "despesa",
      categoriaId: "cat",
      contaId: "conta-1",
    });

    expect(criada.workspaceId).toBe(estado.wsB);
  });
});
