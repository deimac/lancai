import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MotorFinanceiro, RepositorioFinanceiroMemoria } from "@lancai/financeiro";
import {
  ProvedorDuble,
  RepositorioOpenFinanceMemoria,
  ServicoConexaoOpenFinance,
} from "@lancai/open-finance";

const WORKSPACE = "00000000-0000-4000-8000-000000000010";
const ITEM_SALVO = "item-abc";
const ITEM_MORTO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const estado = vi.hoisted(() => ({
  servico: null as ServicoConexaoOpenFinance | null,
}));

vi.mock("../servicos/open-finance", () => ({
  obter_servico_conexao: () => estado.servico,
  obter_servico_ingestao: () => null,
}));

vi.mock("../servicos/escopo-workspace", () => ({
  exigir_workspace_escrita: async () => WORKSPACE,
  obter_workspaces_do_usuario: async () => [WORKSPACE],
  obter_escopo_leitura: vi.fn(),
}));

import { registrar_rotas_open_finance } from "../rotas/open-finance";

describe("POST /open-finance/conexoes/inspecionar — item 404", () => {
  let provedor: ProvedorDuble;
  let servico: ServicoConexaoOpenFinance;
  let usuarioId: string;

  beforeEach(() => {
    provedor = new ProvedorDuble();
    servico = new ServicoConexaoOpenFinance(
      provedor,
      new RepositorioOpenFinanceMemoria(),
      new MotorFinanceiro(new RepositorioFinanceiroMemoria()),
    );
    estado.servico = servico;
    usuarioId = randomUUID();

    provedor.registrarContas(ITEM_SALVO, [
      { idExterno: "acc-1", nome: "Conta Corrente", tipo: "BANK", saldo: 100 },
    ]);
  });

  async function app_com_rotas() {
    const app = Fastify({ logger: false });
    await app.register(registrar_rotas_open_finance, { prefix: "/open-finance" });
    return app;
  }

  async function registrar() {
    return servico.registrar_conexao({
      workspaceId: WORKSPACE,
      usuarioId,
      conexaoExterna: ITEM_SALVO,
    });
  }

  it("404 do idExterno salvo marca removida e não vaza GET /items", async () => {
    const { conexao } = await registrar();
    provedor.marcar_inexistente(ITEM_SALVO);
    const app = await app_com_rotas();

    const resposta = await app.inject({
      method: "POST",
      url: "/open-finance/conexoes/inspecionar",
      payload: {
        usuarioId,
        conexaoExterna: ITEM_SALVO,
        conexaoId: conexao.id,
      },
    });

    const corpo = resposta.json() as { erro?: string; conexaoDesconectada?: boolean };
    expect(resposta.statusCode).toBe(400);
    expect(JSON.stringify(corpo)).not.toMatch(/GET \/items/);
    expect(corpo.erro).toMatch(/não existe mais/i);
    expect(corpo.erro).toMatch(/desconectada/i);
    expect(corpo.conexaoDesconectada).toBe(true);
    expect((await servico.detalhar(conexao.id)).conexao.status).toBe("removida");
    await app.close();
  });

  it("404 de outro UUID não derruba a conexão viva ao lado", async () => {
    const { conexao } = await registrar();
    provedor.marcar_inexistente(ITEM_MORTO);
    const app = await app_com_rotas();

    const resposta = await app.inject({
      method: "POST",
      url: "/open-finance/conexoes/inspecionar",
      payload: {
        usuarioId,
        conexaoExterna: ITEM_MORTO,
        conexaoId: conexao.id,
      },
    });

    const corpo = resposta.json() as { erro?: string; conexaoDesconectada?: boolean };
    expect(resposta.statusCode).toBe(400);
    expect(JSON.stringify(corpo)).not.toMatch(/GET \/items/);
    expect(corpo.erro).toMatch(/Não encontramos este itemId/);
    expect(corpo.conexaoDesconectada).toBeUndefined();
    expect((await servico.detalhar(conexao.id)).conexao.status).toBe("ativa");
    await app.close();
  });
});
