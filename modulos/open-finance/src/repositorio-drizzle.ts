import { and, asc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import {
  CATEGORIA_NAO_CLASSIFICADO,
  categoria as categoriaTabela,
  obter_banco,
  openFinanceConexao as conexaoTabela,
  openFinanceContaExterna as contaExternaTabela,
  openFinanceEvento as eventoTabela,
} from "@lancai/banco";
import type {
  ConexaoDetalhada,
  ConexaoRegistrada,
  ContaExternaDescoberta,
  ContaExternaRegistrada,
  EstadoConexaoParaGravar,
  EventoOpenFinanceComErro,
  RepositorioOpenFinance,
} from "./repositorio";

export class RepositorioOpenFinanceDrizzle implements RepositorioOpenFinance {
  private get banco() {
    return obter_banco();
  }

  /**
   * A unicidade de `(provedor, evento_id)` é o que decide, e não uma consulta
   * antes de inserir: duas entregas simultâneas do mesmo evento passariam pela
   * consulta e seriam processadas em dobro. Aqui o banco resolve a corrida.
   */
  async registrarEvento(evento: {
    provedor: string;
    eventoId: string;
    tipo: string;
    payload: unknown;
  }): Promise<boolean> {
    const inseridos = await this.banco
      .insert(eventoTabela)
      .values({
        provedor: evento.provedor,
        eventoId: evento.eventoId,
        tipo: evento.tipo,
        payload: evento.payload,
      })
      .onConflictDoNothing({ target: [eventoTabela.provedor, eventoTabela.eventoId] })
      .returning({ id: eventoTabela.id });

    return inseridos.length > 0;
  }

  async marcarEventoProcessado(chave: {
    provedor: string;
    eventoId: string;
    erro?: string;
  }): Promise<void> {
    await this.banco
      .update(eventoTabela)
      .set({ processadoEm: new Date(), erro: chave.erro ?? null })
      .where(
        and(eq(eventoTabela.provedor, chave.provedor), eq(eventoTabela.eventoId, chave.eventoId)),
      );
  }

  async listarEventosComErro(entrada: {
    provedor: string;
    limite: number;
  }): Promise<EventoOpenFinanceComErro[]> {
    const linhas = await this.banco
      .select({
        provedor: eventoTabela.provedor,
        eventoId: eventoTabela.eventoId,
        tipo: eventoTabela.tipo,
        payload: eventoTabela.payload,
        erro: eventoTabela.erro,
        processadoEm: eventoTabela.processadoEm,
        dataCriacao: eventoTabela.dataCriacao,
      })
      .from(eventoTabela)
      .where(
        and(eq(eventoTabela.provedor, entrada.provedor), isNotNull(eventoTabela.erro)),
      )
      .orderBy(asc(eventoTabela.dataCriacao))
      .limit(entrada.limite);

    return linhas.map((linha) => ({
      provedor: linha.provedor,
      eventoId: linha.eventoId,
      tipo: linha.tipo,
      payload: linha.payload,
      erro: linha.erro!,
      processadoEm: linha.processadoEm,
      dataCriacao: linha.dataCriacao,
    }));
  }

  async anonimizarPayloadsAntigos(entrada: {
    provedor: string;
    maisAntigosQue: Date;
    limite: number;
    stub: unknown;
  }): Promise<number> {
    /**
     * Payload já anonimizado traz `_lancai.payloadPurgadoEm`. O filtro em SQL
     * evita reescrever o stub a cada cron.
     */
    const candidatos = await this.banco
      .select({ id: eventoTabela.id })
      .from(eventoTabela)
      .where(
        and(
          eq(eventoTabela.provedor, entrada.provedor),
          isNull(eventoTabela.erro),
          isNotNull(eventoTabela.processadoEm),
          lt(eventoTabela.dataCriacao, entrada.maisAntigosQue),
          sql`(${eventoTabela.payload} -> '_lancai' ->> 'payloadPurgadoEm') is null`,
        ),
      )
      .orderBy(asc(eventoTabela.dataCriacao))
      .limit(entrada.limite);

    if (candidatos.length === 0) return 0;

    await this.banco
      .update(eventoTabela)
      .set({ payload: entrada.stub })
      .where(
        inArray(
          eventoTabela.id,
          candidatos.map((c) => c.id),
        ),
      );

    return candidatos.length;
  }

  async obterConexao(provedor: string, idExterno: string): Promise<ConexaoRegistrada | undefined> {
    const linhas = await this.banco
      .select({
        id: conexaoTabela.id,
        workspaceId: conexaoTabela.workspaceId,
        criadoPor: conexaoTabela.criadoPor,
        idExterno: conexaoTabela.idExterno,
        status: conexaoTabela.status,
      })
      .from(conexaoTabela)
      .where(and(eq(conexaoTabela.provedor, provedor), eq(conexaoTabela.idExterno, idExterno)))
      .limit(1);

    const linha = linhas[0];
    if (!linha) return undefined;
    /** Perfil PF/PJ vive na conta/cartão; default da ingestão é pf. */
    return { ...linha, perfilPadrao: "pf" };
  }

  async obterConexaoPorId(id: string): Promise<ConexaoDetalhada | undefined> {
    const linhas = await this.banco
      .select({
        id: conexaoTabela.id,
        workspaceId: conexaoTabela.workspaceId,
        criadoPor: conexaoTabela.criadoPor,
        idExterno: conexaoTabela.idExterno,
        status: conexaoTabela.status,
        instituicao: conexaoTabela.instituicao,
        motivoAtencao: conexaoTabela.motivoAtencao,
        ultimoSyncEm: conexaoTabela.ultimoSyncEm,
        consentimentoExpiraEm: conexaoTabela.consentimentoExpiraEm,
        ultimoResumoIngestao: conexaoTabela.ultimoResumoIngestao,
      })
      .from(conexaoTabela)
      .where(eq(conexaoTabela.id, id))
      .limit(1);

    const linha = linhas[0];
    if (!linha) return undefined;
    return { ...linha, perfilPadrao: "pf" };
  }

  async listarConexoes(workspaceIds: string | string[]): Promise<ConexaoDetalhada[]> {
    const ids = Array.isArray(workspaceIds) ? workspaceIds : [workspaceIds];
    if (ids.length === 0) return [];

    const linhas = await this.banco
      .select({
        id: conexaoTabela.id,
        workspaceId: conexaoTabela.workspaceId,
        criadoPor: conexaoTabela.criadoPor,
        idExterno: conexaoTabela.idExterno,
        status: conexaoTabela.status,
        instituicao: conexaoTabela.instituicao,
        motivoAtencao: conexaoTabela.motivoAtencao,
        ultimoSyncEm: conexaoTabela.ultimoSyncEm,
        consentimentoExpiraEm: conexaoTabela.consentimentoExpiraEm,
        ultimoResumoIngestao: conexaoTabela.ultimoResumoIngestao,
      })
      .from(conexaoTabela)
      .where(inArray(conexaoTabela.workspaceId, ids));

    return linhas.map((conexao) => ({
      ...conexao,
      perfilPadrao: "pf" as const,
    }));
  }

  async registrarConexao(conexao: {
    provedor: string;
    idExterno: string;
    workspaceId: string;
    criadoPor: string;
    instituicao?: string | null;
  }): Promise<ConexaoRegistrada> {
    await this.banco
      .insert(conexaoTabela)
      .values({
        provedor: conexao.provedor,
        idExterno: conexao.idExterno,
        workspaceId: conexao.workspaceId,
        criadoPor: conexao.criadoPor,
        instituicao: conexao.instituicao ?? null,
      })
      .onConflictDoUpdate({
        target: [conexaoTabela.provedor, conexaoTabela.idExterno],
        /**
         * Reabrir o widget na mesma instituição é reconexão, não conexão nova.
         * O `workspace_id` fica de fora do update: mover uma conexão de workspace
         * levaria junto o Fato já ingerido, e isso não é reconexão.
         */
        set: {
          instituicao: conexao.instituicao ?? null,
          status: "ativa",
          motivoAtencao: null,
          dataAtualizacao: new Date(),
        },
      });

    const registrada = await this.obterConexao(conexao.provedor, conexao.idExterno);
    if (!registrada) throw new Error("Conexão não encontrada logo após ser gravada.");
    return registrada;
  }

  async listarContasExternas(conexaoId: string): Promise<ContaExternaRegistrada[]> {
    return this.banco
      .select({
        contaExternaId: contaExternaTabela.idExterno,
        nome: contaExternaTabela.nome,
        tipo: contaExternaTabela.tipo,
        contaId: contaExternaTabela.contaId,
        cartaoId: contaExternaTabela.cartaoId,
      })
      .from(contaExternaTabela)
      .where(eq(contaExternaTabela.conexaoId, conexaoId));
  }

  async encontrarConexaoIdPorDestino(destino: {
    contaId?: string;
    cartaoId?: string;
  }): Promise<string | undefined> {
    if (destino.contaId) {
      const [linha] = await this.banco
        .select({ conexaoId: contaExternaTabela.conexaoId })
        .from(contaExternaTabela)
        .where(eq(contaExternaTabela.contaId, destino.contaId))
        .limit(1);
      if (linha) return linha.conexaoId;
    }
    if (destino.cartaoId) {
      const [linha] = await this.banco
        .select({ conexaoId: contaExternaTabela.conexaoId })
        .from(contaExternaTabela)
        .where(eq(contaExternaTabela.cartaoId, destino.cartaoId))
        .limit(1);
      if (linha) return linha.conexaoId;
    }
    return undefined;
  }

  async apagarConexao(conexaoId: string): Promise<void> {
    await this.banco
      .delete(contaExternaTabela)
      .where(eq(contaExternaTabela.conexaoId, conexaoId));
    await this.banco.delete(conexaoTabela).where(eq(conexaoTabela.id, conexaoId));
  }

  async sincronizarContasExternas(
    conexaoId: string,
    contas: ContaExternaDescoberta[],
  ): Promise<void> {
    if (contas.length === 0) return;

    await this.banco
      .insert(contaExternaTabela)
      .values(
        contas.map((conta) => ({
          conexaoId,
          idExterno: conta.contaExternaId,
          nome: conta.nome,
          tipo: conta.tipo,
        })),
      )
      .onConflictDoUpdate({
        target: [contaExternaTabela.conexaoId, contaExternaTabela.idExterno],
        /** Só nome e tipo. A associação é escolha do usuário e não se reescreve. */
        set: {
          nome: sql`excluded.nome`,
          tipo: sql`excluded.tipo`,
          dataAtualizacao: new Date(),
        },
      });
  }

  async definirAssociacao(
    conexaoId: string,
    contaExternaId: string,
    destino: { contaId: string | null; cartaoId: string | null },
  ): Promise<void> {
    await this.banco
      .update(contaExternaTabela)
      .set({ ...destino, dataAtualizacao: new Date() })
      .where(
        and(
          eq(contaExternaTabela.conexaoId, conexaoId),
          eq(contaExternaTabela.idExterno, contaExternaId),
        ),
      );
  }

  async atualizarEstadoConexao(conexaoId: string, estado: EstadoConexaoParaGravar): Promise<void> {
    await this.banco
      .update(conexaoTabela)
      .set({ ...estado, dataAtualizacao: new Date() })
      .where(eq(conexaoTabela.id, conexaoId));
  }

  async garantirCategoriaNaoClassificado(workspaceId: string, usuarioId: string): Promise<string> {
    const existentes = await this.banco
      .select({ id: categoriaTabela.id })
      .from(categoriaTabela)
      .where(
        and(
          eq(categoriaTabela.workspaceId, workspaceId),
          eq(categoriaTabela.nome, CATEGORIA_NAO_CLASSIFICADO),
        ),
      )
      .limit(1);

    const existente = existentes[0];
    if (existente) return existente.id;

    const criadas = await this.banco
      .insert(categoriaTabela)
      .values({
        nome: CATEGORIA_NAO_CLASSIFICADO,
        tipo: "ambos",
        usuarioId,
        workspaceId,
      })
      .returning({ id: categoriaTabela.id });

    const criada = criadas[0];
    if (!criada) throw new Error("Não foi possível criar a categoria de não classificado.");
    return criada.id;
  }
}
