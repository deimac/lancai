import { randomUUID } from "node:crypto";
import type {
  ConexaoDetalhada,
  ConexaoRegistrada,
  ContaExternaDescoberta,
  ContaExternaRegistrada,
  EstadoConexaoParaGravar,
  EventoOpenFinanceComErro,
  RepositorioOpenFinance,
} from "./repositorio";

interface EventoGravado {
  provedor: string;
  eventoId: string;
  tipo: string;
  payload: unknown;
  processadoEm: Date | null;
  erro: string | null;
  dataCriacao: Date;
}

function conexao_vazia(base: ConexaoRegistrada): ConexaoDetalhada {
  return {
    ...base,
    instituicao: null,
    motivoAtencao: null,
    ultimoSyncEm: null,
    consentimentoExpiraEm: null,
    ultimoResumoIngestao: null,
  };
}

function payload_ja_anonimizado(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  const lancai = (payload as { _lancai?: { payloadPurgadoEm?: unknown } })._lancai;
  return typeof lancai?.payloadPurgadoEm === "string";
}

/** Repositório em memória para teste. Espelha as três tabelas do módulo. */
export class RepositorioOpenFinanceMemoria implements RepositorioOpenFinance {
  readonly eventos = new Map<string, EventoGravado>();
  /** Chaveado por id da conexão. */
  readonly conexoes = new Map<string, ConexaoDetalhada>();
  readonly contasExternas = new Map<string, ContaExternaRegistrada[]>();
  readonly categoriasPorWorkspace = new Map<string, string>();

  /** Histórico de escritas de estado, para o teste afirmar o que foi gravado. */
  readonly estadosGravados: Array<{ conexaoId: string; estado: EstadoConexaoParaGravar }> = [];

  private provedorPadrao = "duble";

  private chave(provedor: string, eventoId: string): string {
    return `${provedor}:${eventoId}`;
  }

  registrarConexaoDireto(provedor: string, conexao: ConexaoRegistrada): void {
    this.provedorPadrao = provedor;
    this.conexoes.set(conexao.id, conexao_vazia(conexao));
  }

  associar(conexaoId: string, contas: ContaExternaRegistrada[]): void {
    this.contasExternas.set(conexaoId, contas);
  }

  async registrarEvento(evento: {
    provedor: string;
    eventoId: string;
    tipo: string;
    payload: unknown;
  }): Promise<boolean> {
    const chave = this.chave(evento.provedor, evento.eventoId);
    if (this.eventos.has(chave)) return false;

    this.eventos.set(chave, {
      ...evento,
      processadoEm: null,
      erro: null,
      dataCriacao: new Date(),
    });
    return true;
  }

  async marcarEventoProcessado(chave: {
    provedor: string;
    eventoId: string;
    erro?: string;
  }): Promise<void> {
    const gravado = this.eventos.get(this.chave(chave.provedor, chave.eventoId));
    if (!gravado) return;

    gravado.processadoEm = new Date();
    gravado.erro = chave.erro ?? null;
  }

  async listarEventosComErro(entrada: {
    provedor: string;
    limite: number;
  }): Promise<EventoOpenFinanceComErro[]> {
    return [...this.eventos.values()]
      .filter((evento) => evento.provedor === entrada.provedor && evento.erro !== null)
      .sort((a, b) => a.dataCriacao.getTime() - b.dataCriacao.getTime())
      .slice(0, entrada.limite)
      .map((evento) => ({
        provedor: evento.provedor,
        eventoId: evento.eventoId,
        tipo: evento.tipo,
        payload: evento.payload,
        erro: evento.erro!,
        processadoEm: evento.processadoEm,
        dataCriacao: evento.dataCriacao,
      }));
  }

  async anonimizarPayloadsAntigos(entrada: {
    provedor: string;
    maisAntigosQue: Date;
    limite: number;
    stub: unknown;
  }): Promise<number> {
    const elegiveis = [...this.eventos.values()]
      .filter(
        (evento) =>
          evento.provedor === entrada.provedor &&
          evento.erro === null &&
          evento.processadoEm !== null &&
          evento.dataCriacao < entrada.maisAntigosQue &&
          !payload_ja_anonimizado(evento.payload),
      )
      .sort((a, b) => a.dataCriacao.getTime() - b.dataCriacao.getTime())
      .slice(0, entrada.limite);

    for (const evento of elegiveis) {
      evento.payload = entrada.stub;
    }
    return elegiveis.length;
  }

  async obterConexao(provedor: string, idExterno: string): Promise<ConexaoRegistrada | undefined> {
    if (provedor !== this.provedorPadrao) return undefined;
    return [...this.conexoes.values()].find((conexao) => conexao.idExterno === idExterno);
  }

  async obterConexaoPorId(id: string): Promise<ConexaoDetalhada | undefined> {
    return this.conexoes.get(id);
  }

  async listarConexoes(workspaceId: string): Promise<ConexaoDetalhada[]> {
    return [...this.conexoes.values()].filter((conexao) => conexao.workspaceId === workspaceId);
  }

  async registrarConexao(conexao: {
    provedor: string;
    idExterno: string;
    workspaceId: string;
    criadoPor: string;
    instituicao?: string | null;
  }): Promise<ConexaoRegistrada> {
    this.provedorPadrao = conexao.provedor;

    const existente = [...this.conexoes.values()].find((c) => c.idExterno === conexao.idExterno);
    if (existente) {
      existente.instituicao = conexao.instituicao ?? null;
      existente.status = "ativa";
      existente.motivoAtencao = null;
      return existente;
    }

    const nova: ConexaoDetalhada = {
      id: randomUUID(),
      workspaceId: conexao.workspaceId,
      criadoPor: conexao.criadoPor,
      idExterno: conexao.idExterno,
      status: "ativa",
      perfilPadrao: "pf",
      instituicao: conexao.instituicao ?? null,
      motivoAtencao: null,
      ultimoSyncEm: null,
      consentimentoExpiraEm: null,
      ultimoResumoIngestao: null,
    };
    this.conexoes.set(nova.id, nova);
    return nova;
  }

  async listarContasExternas(conexaoId: string): Promise<ContaExternaRegistrada[]> {
    return this.contasExternas.get(conexaoId) ?? [];
  }

  async sincronizarContasExternas(
    conexaoId: string,
    contas: ContaExternaDescoberta[],
  ): Promise<void> {
    const atuais = this.contasExternas.get(conexaoId) ?? [];

    for (const descoberta of contas) {
      const existente = atuais.find((c) => c.contaExternaId === descoberta.contaExternaId);
      if (existente) {
        existente.nome = descoberta.nome;
        existente.tipo = descoberta.tipo;
        continue;
      }
      atuais.push({ ...descoberta, contaId: null, cartaoId: null });
    }

    this.contasExternas.set(conexaoId, atuais);
  }

  async definirAssociacao(
    conexaoId: string,
    contaExternaId: string,
    destino: { contaId: string | null; cartaoId: string | null },
  ): Promise<void> {
    const conta = (this.contasExternas.get(conexaoId) ?? []).find(
      (c) => c.contaExternaId === contaExternaId,
    );
    if (!conta) return;

    conta.contaId = destino.contaId;
    conta.cartaoId = destino.cartaoId;
  }

  async atualizarEstadoConexao(conexaoId: string, estado: EstadoConexaoParaGravar): Promise<void> {
    const conexao = this.conexoes.get(conexaoId);
    if (conexao) {
      if (estado.status) conexao.status = estado.status;
      if (estado.motivoAtencao !== undefined) conexao.motivoAtencao = estado.motivoAtencao;
      if (estado.instituicao !== undefined) conexao.instituicao = estado.instituicao;
      if (estado.ultimoSyncEm !== undefined) conexao.ultimoSyncEm = estado.ultimoSyncEm;
      if (estado.consentimentoExpiraEm !== undefined) {
        conexao.consentimentoExpiraEm = estado.consentimentoExpiraEm;
      }
      if (estado.ultimoResumoIngestao !== undefined) {
        conexao.ultimoResumoIngestao = estado.ultimoResumoIngestao;
      }
    }

    this.estadosGravados.push({ conexaoId, estado });
  }

  async garantirCategoriaNaoClassificado(workspaceId: string): Promise<string> {
    const existente = this.categoriasPorWorkspace.get(workspaceId);
    if (existente) return existente;

    const criada = randomUUID();
    this.categoriasPorWorkspace.set(workspaceId, criada);
    return criada;
  }
}
