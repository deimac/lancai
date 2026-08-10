import type { ContextoIngestao, MotorFinanceiro } from "@lancai/financeiro";
import type { EventoFinanceiroNormalizado } from "@lancai/tipos";
import { ErroConexaoNaoEncontrada, ErroLoteInterminavel } from "./erros";
import type {
  MovimentacaoExterna,
  NotificacaoFonte,
  ProvedorOpenFinance,
  WebhookInterpretado,
} from "./provedor";
import type {
  ConexaoRegistrada,
  ContaExternaRegistrada,
  RepositorioOpenFinance,
  ResumoIngestaoPersistido,
} from "./repositorio";

/** 200 páginas de 500 movimentações cobrem com folga a importação de 365 dias. */
const LIMITE_DE_PAGINAS = 200;

/**
 * Dias que o payload bruto fica intacto depois de processado com sucesso.
 * Depois disso vira stub — a linha permanece por causa da idempotência.
 * Alinhado à referência da Pluggy (item sandbox parado ~30 dias).
 */
export const DIAS_RETENCAO_PAYLOAD_PADRAO = 30;

export interface ResumoIngestao {
  criados: number;
  /** Já existiam. Reprocessar um lote é seguro por causa disto. */
  duplicados: number;
  /** Fatos que a instituição alterou e que foram reescritos aqui. */
  atualizados: number;
  /** Fatos que a instituição desfez: cancelados aqui, com a linha preservada. */
  removidos: number;
  /** Conta do provedor sem associação local: nada foi gravado. */
  semDestino: number;
  paginas: number;
  /**
   * Identificadores dos Fatos criados nesta execução. A API usa isto para
   * disparar o motor de regras sem o módulo de Open Finance conhecer
   * Conhecimento — a fronteira fica no composition root.
   */
  movimentoIdsCriados: string[];
}

export interface DetalheReprocessamento {
  eventoId: string;
  ok: boolean;
  erro?: string;
  criados?: number;
  /** Presente quando o processamento voltou a funcionar — a API enriquece. */
  resumo?: ResumoIngestao;
}

export interface ResumoReprocessamento {
  considerados: number;
  ok: number;
  falhas: number;
  movimentoIdsCriados: string[];
  detalhes: DetalheReprocessamento[];
}

/** Relatado durante `importar_historico` para a barra de progresso da UI. */
export interface ProgressoImportacao {
  percentual: number;
  mensagem: string;
  criados: number;
  duplicados: number;
  contaAtual: number;
  contasTotal: number;
}

/** Função, e não constante, para que nenhum chamador possa mutar o resumo devolvido. */
function resumo_vazio(): ResumoIngestao {
  return {
    criados: 0,
    duplicados: 0,
    atualizados: 0,
    removidos: 0,
    semDestino: 0,
    paginas: 0,
    movimentoIdsCriados: [],
  };
}

function resumo_persistido(resumo: ResumoIngestao): ResumoIngestaoPersistido {
  return {
    criados: resumo.criados,
    duplicados: resumo.duplicados,
    atualizados: resumo.atualizados,
    removidos: resumo.removidos,
    semDestino: resumo.semDestino,
    paginas: resumo.paginas,
  };
}

/**
 * Recebe o que o provedor anuncia e entrega Fato ao Core. É o único lugar do
 * sistema que junta as duas metades: o adaptador sabe traduzir a instituição mas
 * não conhece nossas contas; o Core conhece nossas contas mas não sabe o que é
 * um provedor. O mapa de contas externas mora no meio.
 *
 * A ingestão é reativa: não existe método aqui para "sincronizar agora" porque o
 * provedor é dono do sync (ADR-015).
 */
export class ServicoIngestaoOpenFinance {
  constructor(
    private readonly provedor: ProvedorOpenFinance,
    private readonly repositorio: RepositorioOpenFinance,
    private readonly motor: MotorFinanceiro,
  ) {}

  /**
   * Etapa que roda dentro do request do webhook. Interpreta o corpo, que é puro,
   * e grava o bruto. Sem chamada de rede: o provedor exige 2XX em menos de cinco
   * segundos e retenta o que demora.
   *
   * `novo` falso significa retentativa de um evento já recebido — o chamador
   * responde 2XX e não processa.
   */
  async receber(corpo: unknown): Promise<{ novo: boolean; interpretado: WebhookInterpretado }> {
    const interpretado = this.provedor.interpretar_notificacao(corpo);

    const novo = await this.repositorio.registrarEvento({
      provedor: this.provedor.id,
      eventoId: interpretado.eventoId,
      tipo: interpretado.tipoBruto,
      payload: corpo,
    });

    return { novo, interpretado };
  }

  /**
   * Etapa que roda depois da resposta. Falha aqui fica registrada no evento, que
   * é o que o cron de rede de segurança procura para reprocessar.
   */
  async processar(interpretado: WebhookInterpretado): Promise<ResumoIngestao> {
    try {
      const resumo = await this.executar(interpretado.notificacao);
      await this.repositorio.marcarEventoProcessado({
        provedor: this.provedor.id,
        eventoId: interpretado.eventoId,
      });
      return resumo;
    } catch (erro) {
      await this.repositorio.marcarEventoProcessado({
        provedor: this.provedor.id,
        eventoId: interpretado.eventoId,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
      throw erro;
    }
  }

  /**
   * Puxa o extrato já coletado no provedor (GET), sem esperar webhook.
   * Cobre registro de itemId existente (Meu Pluggy) e “Atualizar agora”
   * quando o PATCH de sync é recusado.
   */
  async importar_historico(
    conexaoId: string,
    opcoes: { aoProgresso?: (progresso: ProgressoImportacao) => void } = {},
  ): Promise<ResumoIngestao> {
    const conexao = await this.repositorio.obterConexaoPorId(conexaoId);
    if (!conexao) throw new ErroConexaoNaoEncontrada(conexaoId);
    if (conexao.status === "removida") return resumo_vazio();

    const referencias = await this.provedor.listar_referencias_historico(conexao.idExterno);
    const total = resumo_vazio();
    const contasTotal = Math.max(referencias.length, 1);
    const basePercentual = 12;
    const faixaImportacao = 88;

    const emitir = (entrada: {
      percentual: number;
      mensagem: string;
      contaAtual: number;
    }) => {
      opcoes.aoProgresso?.({
        percentual: Math.max(0, Math.min(100, Math.round(entrada.percentual))),
        mensagem: entrada.mensagem,
        criados: total.criados,
        duplicados: total.duplicados,
        contaAtual: entrada.contaAtual,
        contasTotal: referencias.length,
      });
    };

    if (referencias.length === 0) {
      emitir({ percentual: 100, mensagem: "Nenhum lançamento novo para importar.", contaAtual: 0 });
      await this.registrar_resumo_sync(conexao.id, total);
      return total;
    }

    for (let i = 0; i < referencias.length; i++) {
      const referencia = referencias[i]!;
      const contaAtual = i + 1;
      const inicioFaixa = basePercentual + (i / contasTotal) * faixaImportacao;
      const larguraFaixa = faixaImportacao / contasTotal;

      emitir({
        percentual: inicioFaixa,
        mensagem: `Importando extrato (${contaAtual}/${referencias.length})…`,
        contaAtual,
      });

      const parte = await this.ingerir_lote(conexao, referencia, {
        aoPagina: ({ paginas }) => {
          const frac = 1 - 1 / (1 + paginas * 0.4);
          emitir({
            percentual: inicioFaixa + larguraFaixa * frac * 0.95,
            mensagem: `Importando extrato (${contaAtual}/${referencias.length})…`,
            contaAtual,
          });
        },
      });

      total.criados += parte.criados;
      total.duplicados += parte.duplicados;
      total.atualizados += parte.atualizados;
      total.removidos += parte.removidos;
      total.semDestino += parte.semDestino;
      total.paginas += parte.paginas;
      total.movimentoIdsCriados.push(...parte.movimentoIdsCriados);

      emitir({
        percentual: basePercentual + ((i + 1) / contasTotal) * faixaImportacao,
        mensagem: `Importando extrato (${contaAtual}/${referencias.length})…`,
        contaAtual,
      });
    }

    emitir({
      percentual: 100,
      mensagem: "Importação concluída.",
      contaAtual: referencias.length,
    });

    return total;
  }

  /** Lista eventos com erro, sem processar — útil para `?dryRun=1` do cron. */
  async listar_falhos(opcoes: { limite?: number } = {}) {
    const limite = opcoes.limite ?? 50;
    return this.repositorio.listarEventosComErro({
      provedor: this.provedor.id,
      limite,
    });
  }

  /**
   * Rede de segurança: tenta de novo os webhooks cujo `processar` falhou.
   * Idempotente — o Core deduplica por `id_externo`. Não chama `receber` de
   * novo: o evento já está gravado; só reinterpreta o payload e processa.
   */
  async reprocessar_falhos(opcoes: { limite?: number } = {}): Promise<ResumoReprocessamento> {
    const eventos = await this.listar_falhos(opcoes);

    const resumo: ResumoReprocessamento = {
      considerados: eventos.length,
      ok: 0,
      falhas: 0,
      movimentoIdsCriados: [],
      detalhes: [],
    };

    for (const evento of eventos) {
      let interpretou = false;
      try {
        const interpretado = this.provedor.interpretar_notificacao(evento.payload);
        interpretou = true;
        const processado = await this.processar({
          ...interpretado,
          /** Mantém a chave do evento gravado, não a que o adaptador reler. */
          eventoId: evento.eventoId,
        });
        resumo.ok += 1;
        resumo.movimentoIdsCriados.push(...processado.movimentoIdsCriados);
        resumo.detalhes.push({
          eventoId: evento.eventoId,
          ok: true,
          criados: processado.criados,
          resumo: processado,
        });
      } catch (erro) {
        const mensagem = erro instanceof Error ? erro.message : String(erro);
        /**
         * `processar` já grava o erro quando falha nele. Se a falha foi ao
         * reinterpretar o payload, ainda precisa registrar.
         */
        if (!interpretou) {
          await this.repositorio.marcarEventoProcessado({
            provedor: this.provedor.id,
            eventoId: evento.eventoId,
            erro: mensagem,
          });
        }
        resumo.falhas += 1;
        resumo.detalhes.push({ eventoId: evento.eventoId, ok: false, erro: mensagem });
      }
    }

    return resumo;
  }

  /**
   * LGPD / volume: remove o corpo financeiro do webhook antigo, mantendo
   * `(provedor, evento_id)` para não reprocessar retentativa tardia.
   * Não toca evento com `erro` — o cron de reprocesso ainda precisa do payload.
   */
  async anonimizar_payloads_antigos(
    opcoes: { dias?: number; limite?: number } = {},
  ): Promise<{ anonimizados: number; dias: number }> {
    const dias = opcoes.dias ?? DIAS_RETENCAO_PAYLOAD_PADRAO;
    const limite = opcoes.limite ?? 500;
    const maisAntigosQue = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
    const stub = {
      _lancai: { payloadPurgadoEm: new Date().toISOString(), retencaoDias: dias },
    };

    const anonimizados = await this.repositorio.anonimizarPayloadsAntigos({
      provedor: this.provedor.id,
      maisAntigosQue,
      limite,
      stub,
    });

    return { anonimizados, dias };
  }

  private async executar(notificacao: NotificacaoFonte): Promise<ResumoIngestao> {
    if (notificacao.tipo === "ignorada") {
      return resumo_vazio();
    }

    const conexao = await this.repositorio.obterConexao(this.provedor.id, notificacao.conexaoExterna);
    if (!conexao) {
      /**
       * Conexão que não é nossa. Acontece com credencial compartilhada entre
       * ambientes: um webhook de sandbox pode chegar aqui. Registrar e ignorar é
       * mais seguro do que falhar e provocar retentativa.
       */
      return resumo_vazio();
    }

    switch (notificacao.tipo) {
      case "lote_disponivel":
        return this.ingerir_lote(conexao, notificacao.referencia);

      case "movimentacoes_alteradas":
        return this.ingerir_alteradas(conexao, notificacao.idsExternos);

      case "movimentacoes_removidas":
        return this.remover(conexao, notificacao.idsExternos);

      case "conexao_estado": {
        const estado = await this.provedor.obter_estado(notificacao.conexaoExterna);
        await this.repositorio.atualizarEstadoConexao(conexao.id, {
          status: estado.status,
          motivoAtencao: estado.motivoAtencao ?? null,
          consentimentoExpiraEm: estado.consentimentoExpiraEm ?? null,
          ultimoSyncEm: estado.ultimoSyncEm ?? undefined,
        });
        return resumo_vazio();
      }

      case "conexao_precisa_atencao":
        await this.repositorio.atualizarEstadoConexao(conexao.id, {
          status: "precisa_atencao",
          motivoAtencao: notificacao.motivo,
        });
        return resumo_vazio();

      case "conexao_removida":
        await this.repositorio.atualizarEstadoConexao(conexao.id, {
          status: "removida",
          motivoAtencao: null,
        });
        return resumo_vazio();
    }
  }

  private async ingerir_lote(
    conexao: ConexaoRegistrada,
    inicio: string,
    opcoes: { aoPagina?: (estado: { paginas: number; criados: number }) => void } = {},
  ): Promise<ResumoIngestao> {
    const mapa = await this.mapa_de_contas(conexao.id);
    const contexto = await this.contexto_de_ingestao(conexao);

    const resumo = resumo_vazio();
    const referenciasVistas = new Set<string>();
    let referencia: string | null = inicio;

    while (referencia && !referenciasVistas.has(referencia)) {
      referenciasVistas.add(referencia);
      if (resumo.paginas >= LIMITE_DE_PAGINAS) {
        throw new ErroLoteInterminavel(LIMITE_DE_PAGINAS);
      }

      const lote = await this.provedor.coletar_lote(referencia);
      resumo.paginas += 1;

      const { eventos, semDestino } = this.montar_eventos(lote.movimentacoes, conexao, mapa);
      resumo.semDestino += semDestino;

      if (eventos.length > 0) {
        /**
         * Atualiza o que já existe (ex.: data da parcela PENDING com
         * `billForecastDate`) e só cria o desconhecido — reimportar o histórico
         * deixa de ser “só duplicados”.
         */
        const alteracao = await this.motor.atualizar_fatos_da_fonte(eventos, contexto);
        resumo.atualizados += alteracao.atualizados.length;

        if (alteracao.desconhecidos.length > 0) {
          const resultado = await this.motor.ingerir_eventos(alteracao.desconhecidos, contexto);
          resumo.criados += resultado.criados.length;
          resumo.duplicados += resultado.duplicados;
          resumo.movimentoIdsCriados.push(...resultado.criados.map((m) => m.id));
        }
      }

      opcoes.aoPagina?.({ paginas: resumo.paginas, criados: resumo.criados });

      referencia = lote.proxima;
    }

    await this.repositorio.atualizarEstadoConexao(conexao.id, {
      status: "ativa",
      motivoAtencao: null,
      ultimoSyncEm: new Date(),
      ultimoResumoIngestao: resumo_persistido(resumo),
    });

    return resumo;
  }

  /**
   * Movimentação que mudou na instituição — pendente que virou confirmada, valor
   * ajustado, descrição reescrita. O que já é Fato aqui é atualizado pela porta
   * de sistema do Core, que preserva o Conhecimento; o que a fonte alterou e nós
   * nunca ingerimos é criado, porque é a mesma movimentação chegando atrasada.
   *
   * O caso de criação não é hipotético: uma conta associada depois do primeiro
   * lote deixa passar movimentação que só reaparece num anúncio de alteração.
   */
  private async ingerir_alteradas(
    conexao: ConexaoRegistrada,
    idsExternos: string[],
  ): Promise<ResumoIngestao> {
    if (idsExternos.length === 0) return resumo_vazio();

    const mapa = await this.mapa_de_contas(conexao.id);
    const contexto = await this.contexto_de_ingestao(conexao);

    const movimentacoes = await this.provedor.coletar_por_ids(conexao.idExterno, idsExternos);
    const { eventos, semDestino } = this.montar_eventos(movimentacoes, conexao, mapa);

    if (eventos.length === 0) {
      const soSemDestino = { ...resumo_vazio(), semDestino };
      await this.registrar_resumo_sync(conexao.id, soSemDestino);
      return soSemDestino;
    }

    const alteracao = await this.motor.atualizar_fatos_da_fonte(eventos, contexto);
    const resumo = { ...resumo_vazio(), semDestino, atualizados: alteracao.atualizados.length };

    if (alteracao.desconhecidos.length > 0) {
      const criacao = await this.motor.ingerir_eventos(alteracao.desconhecidos, contexto);
      resumo.criados = criacao.criados.length;
      resumo.duplicados = criacao.duplicados;
      resumo.movimentoIdsCriados = criacao.criados.map((m) => m.id);
    }

    await this.registrar_resumo_sync(conexao.id, resumo);
    return resumo;
  }

  /**
   * A instituição desfez transações. Não recoletamos nada: o identificador
   * externo basta, e pedir ao provedor uma transação que ele acabou de dizer
   * que não existe mais só renderia 404.
   *
   * Remoção de movimentação que nunca ingerimos é o caso comum de conta não
   * associada, e não vira erro — o estado desejado já é o estado.
   */
  private async remover(
    conexao: ConexaoRegistrada,
    idsExternos: string[],
  ): Promise<ResumoIngestao> {
    if (idsExternos.length === 0) return resumo_vazio();

    const contexto = await this.contexto_de_ingestao(conexao);
    const resultado = await this.motor.remover_fatos_da_fonte(
      idsExternos.map((idExterno) => ({
        workspaceId: conexao.workspaceId,
        fonte: "open_finance" as const,
        provedor: this.provedor.id,
        idExterno,
      })),
      contexto,
    );

    const resumo = { ...resumo_vazio(), removidos: resultado.removidos.length };
    await this.registrar_resumo_sync(conexao.id, resumo);
    return resumo;
  }

  /** Atualiza observabilidade sem forçar status (alteração/remoção não “curam” atenção). */
  private async registrar_resumo_sync(
    conexaoId: string,
    resumo: ResumoIngestao,
  ): Promise<void> {
    await this.repositorio.atualizarEstadoConexao(conexaoId, {
      ultimoSyncEm: new Date(),
      ultimoResumoIngestao: resumo_persistido(resumo),
    });
  }

  private async mapa_de_contas(conexaoId: string): Promise<Map<string, ContaExternaRegistrada>> {
    const contas = await this.repositorio.listarContasExternas(conexaoId);
    return new Map(contas.map((conta) => [conta.contaExternaId, conta]));
  }

  private async contexto_de_ingestao(conexao: ConexaoRegistrada): Promise<ContextoIngestao> {
    const categoriaId = await this.repositorio.garantirCategoriaNaoClassificado(
      conexao.workspaceId,
      conexao.criadoPor,
    );

    return {
      usuarioId: conexao.criadoPor,
      criadoPor: conexao.criadoPor,
      categoriaIdNaoClassificado: categoriaId,
      perfilPadrao: conexao.perfilPadrao,
    };
  }

  /**
   * Completa a movimentação externa com o que o adaptador não tem como saber:
   * workspace e conta local. Movimentação de conta não associada é descartada em
   * silêncio contado — associar conta é ato do usuário, não do webhook.
   */
  private montar_eventos(
    movimentacoes: MovimentacaoExterna[],
    conexao: ConexaoRegistrada,
    mapa: Map<string, ContaExternaRegistrada>,
  ): { eventos: EventoFinanceiroNormalizado[]; semDestino: number } {
    const eventos: EventoFinanceiroNormalizado[] = [];
    let semDestino = 0;

    for (const movimentacao of movimentacoes) {
      const associacao = mapa.get(movimentacao.contaExternaId);
      if (!associacao || (!associacao.contaId && !associacao.cartaoId)) {
        semDestino += 1;
        continue;
      }

      eventos.push({
        workspaceId: conexao.workspaceId,
        fonte: "open_finance",
        provedor: this.provedor.id,
        idExterno: movimentacao.idExterno,
        ocorridoEm: movimentacao.ocorridoEm,
        valor: movimentacao.valor,
        tipo: movimentacao.tipo,
        descricaoFonte: movimentacao.descricaoFonte,
        favorecidoFonte: movimentacao.favorecidoFonte,
        contaId: associacao.contaId ?? undefined,
        cartaoId: associacao.cartaoId ?? undefined,
        statusFonte: movimentacao.statusFonte,
        parcelamento: movimentacao.parcelamento,
        /** Nasceu na instituição: o Core recusa alteração manual daqui em diante. */
        fatoImutavel: true,
      });
    }

    return { eventos, semDestino };
  }
}
