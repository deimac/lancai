import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Conta } from "@lancai/banco";
import { MotorFinanceiro, RepositorioFinanceiroMemoria } from "@lancai/financeiro";
import { ErroConexaoExternaInexistente, ErroWebhookInvalido } from "../erros";
import type { MovimentacaoExterna } from "../provedor";
import { ProvedorDuble } from "../provedor-duble";
import { RepositorioOpenFinanceMemoria } from "../repositorio-memoria";
import { ServicoIngestaoOpenFinance } from "../servico-ingestao";

const WORKSPACE = "00000000-0000-4000-8000-000000000010";
const CONEXAO_EXTERNA = "item-abc";
const CONTA_EXTERNA = "acc-1";

function criarConta(sobrepor: Partial<Conta> = {}): Conta {
  const agora = new Date();
  return {
    id: randomUUID(),
    nome: "Nubank",
    saldoInicial: "0.00",
    saldoAtual: "1000.00",
    perfil: "pf",
    ativo: true,
    /** Conta associada a uma conexão é sincronizada: só o sync grava Fato nela. */
    sincronizada: true,
    usuarioId: randomUUID(),
    workspaceId: WORKSPACE,
    dataCriacao: agora,
    dataAtualizacao: agora,
    contaFinanceiraId: null,
    ...sobrepor,
  };
}

function movimentacao(sobrepor: Partial<MovimentacaoExterna> = {}): MovimentacaoExterna {
  return {
    idExterno: "tx-1",
    contaExternaId: CONTA_EXTERNA,
    ocorridoEm: "2026-08-01",
    valor: 90,
    tipo: "despesa",
    descricaoFonte: "COMPRA CARTAO 1234 MERCADO XY",
    statusFonte: "confirmado",
    ...sobrepor,
  };
}

describe("ServicoIngestaoOpenFinance", () => {
  let provedor: ProvedorDuble;
  let repositorio: RepositorioOpenFinanceMemoria;
  let financeiro: RepositorioFinanceiroMemoria;
  let motor: MotorFinanceiro;
  let servico: ServicoIngestaoOpenFinance;
  let conta: Conta;
  let conexaoId: string;
  let usuarioId: string;

  beforeEach(() => {
    provedor = new ProvedorDuble();
    repositorio = new RepositorioOpenFinanceMemoria();
    financeiro = new RepositorioFinanceiroMemoria();
    motor = new MotorFinanceiro(financeiro);
    servico = new ServicoIngestaoOpenFinance(provedor, repositorio, motor);

    usuarioId = randomUUID();
    conexaoId = randomUUID();
    conta = criarConta({ usuarioId });
    financeiro.contas.set(conta.id, conta);

    repositorio.registrarConexaoDireto(provedor.id, {
      id: conexaoId,
      workspaceId: WORKSPACE,
      criadoPor: usuarioId,
      idExterno: CONEXAO_EXTERNA,
      status: "ativa",
      perfilPadrao: "pf",
    });
    repositorio.associar(conexaoId, [
      {
        contaExternaId: CONTA_EXTERNA,
        nome: "Conta Corrente",
        tipo: "BANK",
        contaId: conta.id,
        cartaoId: null,
      },
    ]);
  });

  /** Fluxo completo do webhook: recebe, e processa só se for evento novo. */
  async function entregar(corpo: unknown) {
    const { novo, interpretado } = await servico.receber(corpo);
    if (!novo) return { novo, resumo: null };
    return { novo, resumo: await servico.processar(interpretado) };
  }

  describe("importar histórico sem webhook", () => {
    it("puxa o extrato já semeado no provedor para a conta associada", async () => {
      provedor.semear(CONEXAO_EXTERNA, [
        movimentacao({ idExterno: "tx-1" }),
        movimentacao({ idExterno: "tx-2", valor: 45 }),
      ]);

      const resumo = await servico.importar_historico(conexaoId);

      expect(resumo.criados).toBe(2);
      expect(financeiro.movimentos.size).toBe(2);
    });

    it("marca a conexão como removida quando o item sumiu no provedor", async () => {
      provedor.marcar_inexistente(CONEXAO_EXTERNA);

      await expect(servico.importar_historico(conexaoId)).rejects.toThrow(
        ErroConexaoExternaInexistente,
      );
      expect(repositorio.estadosGravados.at(-1)?.estado.status).toBe("removida");
    });
  });

  describe("o caminho principal", () => {
    it("transforma o lote anunciado em Fato na conta associada", async () => {
      provedor.semear(CONEXAO_EXTERNA, [movimentacao()]);

      const { resumo } = await entregar(provedor.anunciar_lote(CONEXAO_EXTERNA, "ev-1"));

      expect(resumo?.criados).toBe(1);
      expect(financeiro.movimentos.size).toBe(1);

      const [movimento] = [...financeiro.movimentos.values()];
      expect(movimento?.contaId).toBe(conta.id);
      expect(movimento?.workspaceId).toBe(WORKSPACE);
      expect(movimento?.fonte).toBe("open_finance");
      expect(movimento?.provedor).toBe("duble");
      expect(movimento?.descricaoFonte).toBe("COMPRA CARTAO 1234 MERCADO XY");
    });

    it("grava o Fato mesmo na conta sincronizada, que recusa lançamento manual", async () => {
      provedor.semear(CONEXAO_EXTERNA, [movimentacao()]);

      const { resumo } = await entregar(provedor.anunciar_lote(CONEXAO_EXTERNA, "ev-1"));

      expect(conta.sincronizada).toBe(true);
      expect(resumo?.criados).toBe(1);
    });

    it("registra o sync bem-sucedido para a observabilidade", async () => {
      provedor.semear(CONEXAO_EXTERNA, [movimentacao()]);

      await entregar(provedor.anunciar_lote(CONEXAO_EXTERNA, "ev-1"));

      const gravado = repositorio.estadosGravados.at(-1);
      expect(gravado?.conexaoId).toBe(conexaoId);
      expect(gravado?.estado.status).toBe("ativa");
      expect(gravado?.estado.ultimoSyncEm).toBeInstanceOf(Date);
      expect(gravado?.estado.ultimoResumoIngestao).toEqual({
        criados: 1,
        duplicados: 0,
        atualizados: 0,
        removidos: 0,
        semDestino: 0,
        paginas: 1,
      });
    });

    it("fecha o evento como processado", async () => {
      provedor.semear(CONEXAO_EXTERNA, [movimentacao()]);

      await entregar(provedor.anunciar_lote(CONEXAO_EXTERNA, "ev-1"));

      const evento = repositorio.eventos.get("duble:ev-1");
      expect(evento?.processadoEm).toBeInstanceOf(Date);
      expect(evento?.erro).toBeNull();
    });
  });

  describe("idempotência", () => {
    it("descarta a retentativa do mesmo eventoId sem processar de novo", async () => {
      provedor.semear(CONEXAO_EXTERNA, [movimentacao()]);
      const corpo = provedor.anunciar_lote(CONEXAO_EXTERNA, "ev-1");

      const primeira = await entregar(corpo);
      const segunda = await entregar(corpo);

      expect(primeira.novo).toBe(true);
      expect(segunda.novo).toBe(false);
      expect(segunda.resumo).toBeNull();
      /** A prova de que não processou: o provedor não foi consultado outra vez. */
      expect(provedor.lotesColetados).toHaveLength(1);
      expect(financeiro.movimentos.size).toBe(1);
    });

    it("não cria de novo quando o provedor reenvia a mesma transação em evento novo", async () => {
      provedor.semear(CONEXAO_EXTERNA, [movimentacao()]);

      const primeira = await entregar(provedor.anunciar_lote(CONEXAO_EXTERNA, "ev-1"));
      const segunda = await entregar(provedor.anunciar_lote(CONEXAO_EXTERNA, "ev-2"));

      expect(primeira.resumo?.criados).toBe(1);
      expect(segunda.resumo?.criados).toBe(0);
      expect(segunda.resumo?.atualizados).toBe(0);
      expect(financeiro.movimentos.size).toBe(1);
    });
  });

  describe("estado da conexão (item/created|updated)", () => {
    it("sincroniza status quando a conexão já está registrada", async () => {
      provedor.definir_estado(CONEXAO_EXTERNA, {
        status: "sincronizando",
        instituicao: "Banco de Mentira",
      });

      const { resumo } = await entregar(provedor.anunciar_estado(CONEXAO_EXTERNA, "ev-estado"));

      expect(resumo?.criados).toBe(0);
      const gravado = repositorio.estadosGravados.at(-1);
      expect(gravado?.conexaoId).toBe(conexaoId);
      expect(gravado?.estado.status).toBe("sincronizando");
    });
  });

  describe("paginação", () => {
    it("percorre todas as páginas do lote", async () => {
      provedor = new ProvedorDuble({ tamanhoPagina: 2 });
      servico = new ServicoIngestaoOpenFinance(provedor, repositorio, motor);
      provedor.semear(
        CONEXAO_EXTERNA,
        [1, 2, 3, 4, 5].map((n) => movimentacao({ idExterno: `tx-${n}` })),
      );

      const { resumo } = await entregar(provedor.anunciar_lote(CONEXAO_EXTERNA, "ev-1"));

      expect(resumo?.paginas).toBe(3);
      expect(resumo?.criados).toBe(5);
    });
  });

  describe("o que a ingestão recusa", () => {
    it("ignora movimentação de conta externa que ninguém associou", async () => {
      provedor.semear(CONEXAO_EXTERNA, [movimentacao({ contaExternaId: "acc-nao-associada" })]);

      const { resumo } = await entregar(provedor.anunciar_lote(CONEXAO_EXTERNA, "ev-1"));

      expect(resumo?.semDestino).toBe(1);
      expect(resumo?.criados).toBe(0);
      expect(financeiro.movimentos.size).toBe(0);
    });

    it("ignora webhook de conexão desconhecida sem falhar", async () => {
      const { resumo } = await entregar(provedor.anunciar_lote("item-de-outro-ambiente", "ev-1"));

      expect(resumo?.criados).toBe(0);
      expect(provedor.lotesColetados).toHaveLength(0);
    });

    it("registra evento que não interessa sem processar nada", async () => {
      const { resumo } = await entregar({ eventoId: "ev-1", evento: "connector/status_updated" });

      expect(resumo?.criados).toBe(0);
      expect(repositorio.eventos.get("duble:ev-1")?.tipo).toBe("connector/status_updated");
    });

    it("recusa corpo que o adaptador não reconhece", async () => {
      await expect(servico.receber({ semEventoId: true })).rejects.toThrow(ErroWebhookInvalido);
    });
  });

  describe("estado da conexão", () => {
    it("marca que a conexão precisa de atenção quando o consentimento é revogado", async () => {
      await entregar(provedor.anunciar_atencao(CONEXAO_EXTERNA, "ev-1", "consentimento_revogado"));

      const gravado = repositorio.estadosGravados.at(-1);
      expect(gravado?.estado.status).toBe("precisa_atencao");
      expect(gravado?.estado.motivoAtencao).toBe("consentimento_revogado");
    });

    it("marca a conexão como removida quando o provedor apaga o item", async () => {
      await entregar({ eventoId: "ev-1", evento: "conexao_removida", conexao: CONEXAO_EXTERNA });

      expect(repositorio.estadosGravados.at(-1)?.estado.status).toBe("removida");
    });

    it("marca removida se o GET de estado devolver item inexistente", async () => {
      provedor.marcar_inexistente(CONEXAO_EXTERNA);

      await entregar(provedor.anunciar_estado(CONEXAO_EXTERNA, "ev-estado"));

      expect(repositorio.estadosGravados.at(-1)?.estado.status).toBe("removida");
    });
  });

  describe("alteração e remoção na instituição", () => {
    it("cria o que ainda não conhecíamos quando a instituição avisa de alteração", async () => {
      provedor.semear(CONEXAO_EXTERNA, [movimentacao()]);

      const { resumo } = await entregar(
        provedor.anunciar_alteracao(CONEXAO_EXTERNA, "ev-1", ["tx-1"]),
      );

      expect(resumo?.criados).toBe(1);
      expect(resumo?.atualizados).toBe(0);
    });

    it("aplica no Fato o que a instituição alterou, sem duplicar", async () => {
      provedor.semear(CONEXAO_EXTERNA, [movimentacao({ valor: 90, statusFonte: "pendente" })]);
      await entregar(provedor.anunciar_lote(CONEXAO_EXTERNA, "ev-1"));

      provedor.semear(CONEXAO_EXTERNA, [
        movimentacao({ valor: 95.5, statusFonte: "confirmado", descricaoFonte: "MERCADO XY LTDA" }),
      ]);
      const { resumo } = await entregar(
        provedor.anunciar_alteracao(CONEXAO_EXTERNA, "ev-2", ["tx-1"]),
      );

      expect(resumo?.atualizados).toBe(1);
      expect(resumo?.criados).toBe(0);
      expect(financeiro.movimentos.size).toBe(1);

      const movimento = [...financeiro.movimentos.values()][0];
      expect(movimento?.valor).toBe("95.50");
      expect(movimento?.statusFonte).toBe("confirmado");
      expect(movimento?.status).toBe("realizado");
      expect(movimento?.descricaoFonte).toBe("MERCADO XY LTDA");
    });

    /**
     * A janela de recoleta faz a fonte reanunciar o que não mudou. Contar isso
     * como alteração encheria a auditoria de linha sem diferença nenhuma.
     */
    it("não conta como alteração o que chegou igual", async () => {
      provedor.semear(CONEXAO_EXTERNA, [movimentacao()]);
      await entregar(provedor.anunciar_lote(CONEXAO_EXTERNA, "ev-1"));

      const { resumo } = await entregar(
        provedor.anunciar_alteracao(CONEXAO_EXTERNA, "ev-2", ["tx-1"]),
      );

      expect(resumo?.atualizados).toBe(0);
      expect(resumo?.criados).toBe(0);
    });

    /**
     * Desaparecimento registrado, seção 8.6 de 13-OPEN_FINANCE.md: a linha fica.
     * Saldo institucional não deriva do Fato — não sobe/desce na remoção.
     */
    it("cancela o movimento sem mexer no saldo_atual quando a instituição remove", async () => {
      provedor.semear(CONEXAO_EXTERNA, [movimentacao()]);
      await entregar(provedor.anunciar_lote(CONEXAO_EXTERNA, "ev-1"));
      expect(Number(financeiro.contas.get(conta.id)?.saldoAtual)).toBe(1000);

      const { resumo } = await entregar(provedor.anunciar_remocao(CONEXAO_EXTERNA, "ev-2", ["tx-1"]));

      expect(resumo?.removidos).toBe(1);
      expect(financeiro.movimentos.size).toBe(1);

      const movimento = [...financeiro.movimentos.values()][0];
      expect(movimento?.status).toBe("cancelado");
      expect(movimento?.statusFonte).toBe("removido");
      expect(Number(financeiro.contas.get(conta.id)?.saldoAtual)).toBe(1000);
    });

    it("não devolve o saldo duas vezes quando o evento de remoção é reprocessado", async () => {
      provedor.semear(CONEXAO_EXTERNA, [movimentacao()]);
      await entregar(provedor.anunciar_lote(CONEXAO_EXTERNA, "ev-1"));

      await entregar(provedor.anunciar_remocao(CONEXAO_EXTERNA, "ev-2", ["tx-1"]));
      const { resumo } = await entregar(provedor.anunciar_remocao(CONEXAO_EXTERNA, "ev-3", ["tx-1"]));

      expect(resumo?.removidos).toBe(0);
      expect(Number(financeiro.contas.get(conta.id)?.saldoAtual)).toBe(1000);
    });

    it("ignora remoção de movimentação que nunca ingerimos", async () => {
      const { resumo } = await entregar(
        provedor.anunciar_remocao(CONEXAO_EXTERNA, "ev-1", ["tx-nunca-visto"]),
      );

      expect(resumo?.removidos).toBe(0);
      expect(financeiro.movimentos.size).toBe(0);
    });
  });

  describe("falha no processamento", () => {
    it("deixa o erro registrado no evento para o cron reprocessar", async () => {
      provedor.semear(CONEXAO_EXTERNA, [movimentacao()]);
      repositorio.listarContasExternas = async () => {
        throw new Error("banco fora do ar");
      };

      const { interpretado } = await servico.receber(provedor.anunciar_lote(CONEXAO_EXTERNA, "ev-1"));
      await expect(servico.processar(interpretado)).rejects.toThrow("banco fora do ar");

      const evento = repositorio.eventos.get("duble:ev-1");
      expect(evento?.erro).toBe("banco fora do ar");
      expect(evento?.processadoEm).toBeInstanceOf(Date);
    });

    it("reprocessar_falhos recupera o lote quando a causa some", async () => {
      provedor.semear(CONEXAO_EXTERNA, [movimentacao()]);
      const listarOriginal = repositorio.listarContasExternas.bind(repositorio);
      repositorio.listarContasExternas = async () => {
        throw new Error("banco fora do ar");
      };

      const { interpretado } = await servico.receber(provedor.anunciar_lote(CONEXAO_EXTERNA, "ev-1"));
      await expect(servico.processar(interpretado)).rejects.toThrow("banco fora do ar");

      repositorio.listarContasExternas = listarOriginal;
      const reprocesso = await servico.reprocessar_falhos();

      expect(reprocesso.considerados).toBe(1);
      expect(reprocesso.ok).toBe(1);
      expect(reprocesso.falhas).toBe(0);
      expect(reprocesso.movimentoIdsCriados).toHaveLength(1);
      expect(repositorio.eventos.get("duble:ev-1")?.erro).toBeNull();
      expect(financeiro.movimentos.size).toBe(1);
    });

    it("reprocessar_falhos é idempotente quando o Fato já existe", async () => {
      provedor.semear(CONEXAO_EXTERNA, [movimentacao()]);
      await entregar(provedor.anunciar_lote(CONEXAO_EXTERNA, "ev-ok"));

      const falho = provedor.anunciar_lote(CONEXAO_EXTERNA, "ev-falha");
      const listarOriginal = repositorio.listarContasExternas.bind(repositorio);
      repositorio.listarContasExternas = async () => {
        throw new Error("timeout");
      };
      const { interpretado } = await servico.receber(falho);
      await expect(servico.processar(interpretado)).rejects.toThrow("timeout");
      repositorio.listarContasExternas = listarOriginal;

      const primeiro = await servico.reprocessar_falhos();
      const segundo = await servico.reprocessar_falhos();

      expect(primeiro.ok).toBe(1);
      expect(segundo.considerados).toBe(0);
      expect(financeiro.movimentos.size).toBe(1);
    });
  });

  describe("retenção do payload", () => {
    it("anonimiza payload antigo processado e mantém o evento_id", async () => {
      provedor.semear(CONEXAO_EXTERNA, [movimentacao()]);
      await entregar(provedor.anunciar_lote(CONEXAO_EXTERNA, "ev-velho"));

      const evento = repositorio.eventos.get("duble:ev-velho")!;
      evento.dataCriacao = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

      const resultado = await servico.anonimizar_payloads_antigos({ dias: 30 });

      expect(resultado.anonimizados).toBe(1);
      const depois = repositorio.eventos.get("duble:ev-velho")!;
      expect(depois.payload).toMatchObject({
        _lancai: { retencaoDias: 30 },
      });
      expect(
        (depois.payload as { _lancai: { payloadPurgadoEm: string } })._lancai.payloadPurgadoEm,
      ).toMatch(/^\d{4}-\d{2}-\d{2}/);

      /** Idempotência: o mesmo eventoId continua registrado. */
      const { novo } = await servico.receber(provedor.anunciar_lote(CONEXAO_EXTERNA, "ev-velho"));
      expect(novo).toBe(false);
    });

    it("não toca evento com erro nem payload recente", async () => {
      provedor.semear(CONEXAO_EXTERNA, [movimentacao()]);
      await entregar(provedor.anunciar_lote(CONEXAO_EXTERNA, "ev-recente"));

      repositorio.listarContasExternas = async () => {
        throw new Error("falha");
      };
      const { interpretado } = await servico.receber(
        provedor.anunciar_lote(CONEXAO_EXTERNA, "ev-erro"),
      );
      await expect(servico.processar(interpretado)).rejects.toThrow("falha");
      const comErro = repositorio.eventos.get("duble:ev-erro")!;
      comErro.dataCriacao = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

      const resultado = await servico.anonimizar_payloads_antigos({ dias: 30 });

      expect(resultado.anonimizados).toBe(0);
      expect(repositorio.eventos.get("duble:ev-recente")?.payload).toMatchObject({
        eventoId: "ev-recente",
      });
      expect(repositorio.eventos.get("duble:ev-erro")?.payload).toMatchObject({
        eventoId: "ev-erro",
      });
    });
  });
});
