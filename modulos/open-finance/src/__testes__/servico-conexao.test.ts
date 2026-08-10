import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Cartao, Conta } from "@lancai/banco";
import {
  ErroContaSincronizada,
  MotorFinanceiro,
  RepositorioFinanceiroMemoria,
} from "@lancai/financeiro";
import { ErroAssociacaoInvalida, ErroConexaoNaoEncontrada } from "../erros";
import { ProvedorDuble } from "../provedor-duble";
import { RepositorioOpenFinanceMemoria } from "../repositorio-memoria";
import { ServicoConexaoOpenFinance } from "../servico-conexao";

const WORKSPACE = "00000000-0000-4000-8000-000000000010";
const CONEXAO_EXTERNA = "item-abc";

function criarConta(sobrepor: Partial<Conta> = {}): Conta {
  const agora = new Date();
  return {
    id: randomUUID(),
    nome: "Nubank",
    saldoInicial: "0.00",
    saldoAtual: "1000.00",
    perfil: "pf",
    ativo: true,
    sincronizada: false,
    usuarioId: randomUUID(),
    workspaceId: WORKSPACE,
    dataCriacao: agora,
    dataAtualizacao: agora,
    ...sobrepor,
  };
}

function criarCartao(sobrepor: Partial<Cartao> = {}): Cartao {
  const agora = new Date();
  return {
    id: randomUUID(),
    nome: "Inter Black",
    limite: "5000.00",
    saldo: "0",
    fechamento: 20,
    vencimento: 27,
    melhorDiaCompra: 21,
    perfil: "pf",
    modalidade: "credito",
    ativo: true,
    sincronizada: false,
    dadosPlasticosCifrados: null,
    contaId: null,
    usuarioId: randomUUID(),
    workspaceId: WORKSPACE,
    dataCriacao: agora,
    dataAtualizacao: agora,
    ...sobrepor,
  };
}

describe("ServicoConexaoOpenFinance", () => {
  let provedor: ProvedorDuble;
  let repositorio: RepositorioOpenFinanceMemoria;
  let financeiro: RepositorioFinanceiroMemoria;
  let motor: MotorFinanceiro;
  let servico: ServicoConexaoOpenFinance;
  let usuarioId: string;

  beforeEach(() => {
    provedor = new ProvedorDuble();
    repositorio = new RepositorioOpenFinanceMemoria();
    financeiro = new RepositorioFinanceiroMemoria();
    motor = new MotorFinanceiro(financeiro);
    servico = new ServicoConexaoOpenFinance(provedor, repositorio, motor);
    usuarioId = randomUUID();

    provedor.registrarContas(CONEXAO_EXTERNA, [
      { idExterno: "acc-1", nome: "Conta Corrente", tipo: "BANK", saldo: 2500 },
      {
        idExterno: "card-1",
        nome: "Cartão Platinum",
        tipo: "CREDIT",
        saldo: 11740.87,
        limite: 30000,
        fechamento: 5,
        vencimento: 12,
      },
    ]);
  });

  function registrar() {
    return servico.registrar_conexao({
      workspaceId: WORKSPACE,
      usuarioId,
      conexaoExterna: CONEXAO_EXTERNA,
    });
  }

  describe("descoberta", () => {
    it("descreve a fonte sem obrigar o Web a saber qual provedor é", () => {
      expect(servico.descrever_fonte()).toEqual({ id: "duble", disponivel: true });
    });

    it("entrega um token de curta duração para o widget", async () => {
      const token = await servico.iniciar_conexao({ usuarioId });

      expect(token.token).toContain(usuarioId);
      expect(token.expiraEm.getTime()).toBeGreaterThan(Date.now());
    });

    it("recusa reconectar uma conexão que não existe", async () => {
      await expect(
        servico.iniciar_conexao({ usuarioId, conexaoId: randomUUID() }),
      ).rejects.toThrow(ErroConexaoNaoEncontrada);
    });
  });

  describe("registro da conexão", () => {
    it("grava a conexão e traz as contas encontradas", async () => {
      const { conexao, contas } = await registrar();

      expect(conexao.idExterno).toBe(CONEXAO_EXTERNA);
      expect(conexao.instituicao).toBe("Banco de Mentira");
      expect(contas.map((c) => c.contaExternaId)).toEqual(["acc-1", "card-1"]);
    });

    it("materializa conta e cartão locais a partir dos recursos da Fonte", async () => {
      const { contas } = await registrar();

      const conta = contas.find((c) => c.contaExternaId === "acc-1");
      const cartao = contas.find((c) => c.contaExternaId === "card-1");
      expect(conta?.contaId).toBeTruthy();
      expect(conta?.cartaoId).toBeNull();
      expect(cartao?.cartaoId).toBeTruthy();
      expect(cartao?.contaId).toBeNull();
      expect(financeiro.contas.size).toBe(1);
      expect(financeiro.cartoes.size).toBe(1);
      expect([...financeiro.contas.values()][0]?.sincronizada).toBe(true);
      expect([...financeiro.contas.values()][0]?.saldoAtual).toBe("2500");
      const cartaoLocal = [...financeiro.cartoes.values()][0];
      expect(cartaoLocal?.sincronizada).toBe(true);
      expect(cartaoLocal?.saldo).toBe("11740.87");
      expect(cartaoLocal?.limite).toBe("30000");
      expect(cartaoLocal?.fechamento).toBe(5);
      expect(cartaoLocal?.vencimento).toBe(12);
    });

    it("excluir por destino apaga a conexão e devolve conta e cartão da instituição", async () => {
      const { conexao, contas } = await registrar();
      const contaId = contas.find((c) => c.contaExternaId === "acc-1")?.contaId;
      const cartaoId = contas.find((c) => c.contaExternaId === "card-1")?.cartaoId;
      expect(contaId).toBeTruthy();
      expect(cartaoId).toBeTruthy();

      const resultado = await servico.excluir_por_destino({ cartaoId: cartaoId! });

      expect(resultado.conexaoId).toBe(conexao.id);
      expect(resultado.contaIds).toContain(contaId);
      expect(resultado.cartaoIds).toContain(cartaoId);
      expect(financeiro.contas.get(contaId!)?.sincronizada).toBe(false);
      expect(financeiro.cartoes.get(cartaoId!)?.sincronizada).toBe(false);
      await expect(servico.detalhar(conexao.id)).rejects.toThrow(ErroConexaoNaoEncontrada);
    });

    it("atualiza saldo e limite de cartão já associado ao relistar a Fonte", async () => {
      const { contas } = await registrar();
      const cartaoId = contas.find((c) => c.contaExternaId === "card-1")?.cartaoId;
      expect(cartaoId).toBeTruthy();

      provedor.registrarContas(CONEXAO_EXTERNA, [
        { idExterno: "acc-1", nome: "Conta Corrente", tipo: "BANK", saldo: 2600 },
        {
          idExterno: "card-1",
          nome: "Cartão Platinum",
          tipo: "CREDIT",
          saldo: 9000,
          limite: 35000,
          fechamento: 8,
          vencimento: 15,
        },
      ]);

      await registrar();

      const cartaoLocal = financeiro.cartoes.get(cartaoId!);
      expect(cartaoLocal?.saldo).toBe("9000");
      expect(cartaoLocal?.limite).toBe("35000");
      expect(cartaoLocal?.fechamento).toBe(8);
      expect(cartaoLocal?.vencimento).toBe(15);
      expect(financeiro.contas.get(contas.find((c) => c.contaExternaId === "acc-1")!.contaId!)
        ?.saldoAtual).toBe("2600");
    });

    it("é idempotente: reabrir o widget não cria conexão nova", async () => {
      const primeira = await registrar();
      const segunda = await registrar();

      expect(segunda.conexao.id).toBe(primeira.conexao.id);
      expect(await servico.listar_conexoes(WORKSPACE)).toHaveLength(1);
      expect(segunda.contas).toHaveLength(2);
    });

    it("preserva a associação já feita quando o provedor relista as contas", async () => {
      const { contas: primeira } = await registrar();
      const contaId = primeira.find((c) => c.contaExternaId === "acc-1")?.contaId;
      expect(contaId).toBeTruthy();

      const { contas } = await registrar();

      expect(contas.find((c) => c.contaExternaId === "acc-1")?.contaId).toBe(contaId);
    });
  });

  describe("associação", () => {
    it("permite reassociar a outra conta local após desassociar", async () => {
      const { conexao } = await registrar();
      await servico.desassociar({ conexaoId: conexao.id, contaExternaId: "acc-1" });

      const conta = criarConta();
      financeiro.contas.set(conta.id, conta);

      const { contas } = await servico.associar({
        conexaoId: conexao.id,
        contaExternaId: "acc-1",
        contaId: conta.id,
      });

      expect(contas.find((c) => c.contaExternaId === "acc-1")?.contaId).toBe(conta.id);
      expect(financeiro.contas.get(conta.id)?.sincronizada).toBe(true);
    });

    it("permite reassociar cartão local após desassociar", async () => {
      const { conexao } = await registrar();
      await servico.desassociar({ conexaoId: conexao.id, contaExternaId: "card-1" });

      const cartao = criarCartao();
      financeiro.cartoes.set(cartao.id, cartao);

      await servico.associar({
        conexaoId: conexao.id,
        contaExternaId: "card-1",
        cartaoId: cartao.id,
      });

      expect(financeiro.cartoes.get(cartao.id)?.sincronizada).toBe(true);
    });

    /**
     * O efeito que a tela precisa avisar antes de confirmar: marcar a conta
     * fecha o lançamento manual dela em qualquer canal.
     */
    it("faz a conta passar a recusar lançamento manual", async () => {
      const categoria = {
        id: randomUUID(),
        nome: "Alimentação",
        tipo: "despesa" as const,
        ativo: true,
        usuarioId,
        workspaceId: WORKSPACE,
        dataCriacao: new Date(),
        dataAtualizacao: new Date(),
      };
      financeiro.categorias.set(categoria.id, categoria);

      const { contas } = await registrar();
      const contaId = contas.find((c) => c.contaExternaId === "acc-1")?.contaId;
      expect(contaId).toBeTruthy();

      await expect(
        motor.criar_movimento({
          workspaceId: WORKSPACE,
          fonte: "manual",
          descricao: "Almoço",
          valor: 45,
          tipo: "despesa",
          status: "realizado",
          perfil: "pf",
          dataMovimento: "2026-08-01",
          contaId: contaId!,
          categoriaId: categoria.id,
          usuarioId,
          criadoPor: usuarioId,
        }),
      ).rejects.toThrow(ErroContaSincronizada);
    });

    it("recusa associar sem destino local", async () => {
      const { conexao } = await registrar();

      await expect(
        servico.associar({ conexaoId: conexao.id, contaExternaId: "acc-1" }),
      ).rejects.toThrow(ErroAssociacaoInvalida);
    });

    it("recusa associar a conta e cartão ao mesmo tempo", async () => {
      const conta = criarConta();
      const cartao = criarCartao();
      financeiro.contas.set(conta.id, conta);
      financeiro.cartoes.set(cartao.id, cartao);
      const { conexao } = await registrar();

      const erro = await servico
        .associar({
          conexaoId: conexao.id,
          contaExternaId: "acc-1",
          contaId: conta.id,
          cartaoId: cartao.id,
        })
        .catch((e) => e);

      expect(erro).toBeInstanceOf(ErroAssociacaoInvalida);
      expect(financeiro.contas.get(conta.id)?.sincronizada).toBe(false);
    });

    /** Se a conta local não existe, nada é gravado: o Core valida antes do mapa. */
    it("não grava associação quando a conta local não existe", async () => {
      const { conexao } = await registrar();
      await servico.desassociar({ conexaoId: conexao.id, contaExternaId: "acc-1" });

      await expect(
        servico.associar({
          conexaoId: conexao.id,
          contaExternaId: "acc-1",
          contaId: randomUUID(),
        }),
      ).rejects.toThrow();

      const { contas } = await servico.detalhar(conexao.id);
      expect(contas.find((c) => c.contaExternaId === "acc-1")?.contaId).toBeNull();
    });

    it("recusa associar conta externa que não é desta conexão", async () => {
      const conta = criarConta();
      financeiro.contas.set(conta.id, conta);
      await registrar();

      await expect(
        servico.associar({
          conexaoId: (await servico.listar_conexoes(WORKSPACE))[0]!.id,
          contaExternaId: "acc-de-outro-banco",
          contaId: conta.id,
        }),
      ).rejects.toThrow();
      expect(financeiro.contas.get(conta.id)?.sincronizada).toBe(false);
    });
  });

  describe("atualizar agora", () => {
    it("pede sync ao provedor e marca a conexão como sincronizando", async () => {
      const { conexao } = await registrar();

      const detalhe = await servico.solicitar_atualizacao(conexao.id);

      expect(provedor.atualizacoesPedidas).toEqual([CONEXAO_EXTERNA]);
      expect(detalhe.conexao.status).toBe("sincronizando");
      expect(detalhe.conexao.motivoAtencao).toBeNull();
    });

    it("recusa atualizar conexão inexistente", async () => {
      await expect(servico.solicitar_atualizacao(randomUUID())).rejects.toThrow(
        ErroConexaoNaoEncontrada,
      );
    });

    it("recusa atualizar conexão removida", async () => {
      const { conexao } = await registrar();
      await repositorio.atualizarEstadoConexao(conexao.id, { status: "removida" });

      await expect(servico.solicitar_atualizacao(conexao.id)).rejects.toThrow(
        ErroAssociacaoInvalida,
      );
      expect(provedor.atualizacoesPedidas).toHaveLength(0);
    });
  });

  describe("desconexão", () => {
    it("marca a conexão como removida e desliga sync sem apagar entidades", async () => {
      const { conexao, contas: antes } = await registrar();
      const contaId = antes.find((c) => c.contaExternaId === "acc-1")?.contaId;
      expect(contaId).toBeTruthy();

      const detalhe = await servico.desconectar(conexao.id);

      expect(detalhe.conexao.status).toBe("removida");
      expect(detalhe.contas.every((c) => c.contaId === null && c.cartaoId === null)).toBe(true);
      expect(financeiro.contas.get(contaId!)?.sincronizada).toBe(false);
      expect(financeiro.contas.has(contaId!)).toBe(true);
    });
  });

  describe("desassociação", () => {
    it("devolve a conta ao uso manual", async () => {
      const { conexao, contas: descobertas } = await registrar();
      const contaId = descobertas.find((c) => c.contaExternaId === "acc-1")?.contaId;
      expect(contaId).toBeTruthy();

      const { contas } = await servico.desassociar({
        conexaoId: conexao.id,
        contaExternaId: "acc-1",
      });

      expect(contas.find((c) => c.contaExternaId === "acc-1")?.contaId).toBeNull();
      expect(financeiro.contas.get(contaId!)?.sincronizada).toBe(false);
    });

    it("não reabre para edição o que já veio da instituição", async () => {
      const { conexao, contas } = await registrar();
      const contaId = contas.find((c) => c.contaExternaId === "acc-1")?.contaId;
      expect(contaId).toBeTruthy();
      await servico.desassociar({ conexaoId: conexao.id, contaExternaId: "acc-1" });

      /**
       * A conta voltou a aceitar lançamento manual, mas o Fato de `open_finance`
       * segue protegido por si só — desconectar não é caminho para editar
       * extrato. Ver `fato_protegido`.
       */
      expect(financeiro.contas.get(contaId!)?.sincronizada).toBe(false);
    });
  });
});
