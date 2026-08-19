import { randomUUID } from "node:crypto";
import {
  arredondar,
  deISOParaData,
  paraColuna,
  paraNumero,
  schemaCorrigirFatoManual,
  schemaCriarMovimento,
  schemaEventoFinanceiroNormalizado,
} from "@lancai/tipos";
import type {
  CamposFatoManual,
  EntradaCorrigirFatoManual,
  EntradaCriarMovimento,
  EventoFinanceiroNormalizado,
  ParcelamentoFonte,
  TipoFonte,
} from "@lancai/tipos";
import {
  CATEGORIA_NAO_CLASSIFICADO,
  type Cartao,
  type Conta,
  type Movimento,
  type NovaAuditoria,
  type NovaParcela,
  type NovoMovimento,
} from "@lancai/banco";
import { calcular_saldo, obter_direcao_padrao, tipo_movimento_implementado } from "./calcular-saldo";
import { calcular_fingerprint_movimento } from "./fingerprint";
import { eh_fluxo_cruzado } from "./fluxo-cruzado";
import { registrar_parcelamento } from "./registrar-parcelamento";
import {
  ErroContaSincronizada,
  ErroFatoImutavel,
  ErroLimiteCartaoExcedido,
  ErroRecursoNaoEncontrado,
  ErroTipoMovimentoNaoImplementado,
  ErroValidacaoFinanceira,
} from "./erros";
import type {
  OperacaoAtualizacaoFonte,
  OperacaoCorrecao,
  RepositorioFinanceiro,
  ResultadoOperacaoPersistencia,
} from "./repositorio";

export type ResultadoCriarMovimento = ResultadoOperacaoPersistencia;

/**
 * O que a ingestão precisa saber e que o evento não carrega, porque não é Fato.
 * Categoria inicial vem daqui; o tipo de gasto do movimento segue o perfil da
 * conta/cartão destino (com `perfilPadrao` só como fallback).
 */
export interface ContextoIngestao {
  usuarioId: string;
  criadoPor: string;
  categoriaIdNaoClassificado: string;
  /** Usado só se a conta/cartão do evento não estiver acessível. */
  perfilPadrao: "pf" | "pj";
}

export interface ResultadoIngestao {
  criados: Movimento[];
  /** Eventos que já estavam registrados. Reprocessar um lote é seguro. */
  duplicados: number;
}

export interface ResultadoAtualizacaoFonte {
  atualizados: Movimento[];
  /**
   * A fonte anunciou alteração de algo que nunca ingerimos — conta que não estava
   * associada quando o Fato original passou, por exemplo. Quem chamou decide se
   * cria; o Core não inventa Fato dentro de uma operação de alteração.
   */
  desconhecidos: EventoFinanceiroNormalizado[];
  /** Chegaram idênticos ao que já está gravado. A janela de recoleta gera muitos. */
  inalterados: number;
}

export interface ResultadoRemocaoFonte {
  removidos: Movimento[];
  /** Nunca foram ingeridos aqui. Nada a fazer: a remoção já é o estado. */
  desconhecidos: number;
  /** Já estavam marcados como removidos. Reprocessar o evento é seguro. */
  jaRemovidos: number;
}

/**
 * Quanto um movimento pesa no saldo da conta agora. Zero quando não está
 * realizado, o que faz a diferença entre dois estados cobrir de uma vez mudança
 * de valor, inversão de tipo e pendente virando confirmada.
 */
/**
 * O parcelamento que a instituição informou, achatado nas colunas de Fato. As
 * quatro andam juntas: gravar número sem total, ou total sem valor, deixaria o
 * Conhecimento sem como agrupar as parcelas de uma mesma compra.
 */
function parcelamento_em_colunas(
  parcelamento: ParcelamentoFonte | undefined,
): Pick<
  NovoMovimento,
  "parcelaNumero" | "parcelaTotal" | "parcelaCompraEm" | "parcelaCompraValor"
> {
  return {
    parcelaNumero: parcelamento?.numero ?? null,
    parcelaTotal: parcelamento?.total ?? null,
    parcelaCompraEm: parcelamento?.compraEm ?? null,
    parcelaCompraValor:
      parcelamento?.valorTotal !== undefined ? paraColuna(parcelamento.valorTotal) : null,
  };
}

function efeito_no_saldo(movimento: {
  tipo: Movimento["tipo"];
  status: Movimento["status"];
  valor: string | number;
}): number {
  if (movimento.status !== "realizado") return 0;

  const direcao = obter_direcao_padrao(movimento.tipo);
  if (direcao === undefined) throw new ErroTipoMovimentoNaoImplementado(movimento.tipo);

  return direcao * paraNumero(movimento.valor);
}

/**
 * Coração do sistema: valida informações, aplica regras, cria lançamentos,
 * recalcula saldos, gera parcelas e aciona a auditoria. É o único componente
 * com autoridade para alterar o estado financeiro do usuário (ADR-002).
 *
 * A IA nunca chama o banco diretamente — ela só monta a `EntradaCriarMovimento`
 * que é passada para `criar_movimento`.
 */
export class MotorFinanceiro {
  constructor(private readonly repositorio: RepositorioFinanceiro) {}

  /**
   * Colunas do grupo Fato que acompanham todo lançamento criado. `descricaoFonte`
   * cai para `descricao` quando a fonte não trouxe um original — é o caso de
   * tudo que uma pessoa digita.
   */
  private campos_de_fato(
    entrada: EntradaCriarMovimento,
    descricao: string,
    sufixoIdExterno?: string,
  ): Pick<
    NovoMovimento,
    | "workspaceId"
    | "fonte"
    | "provedor"
    | "idExterno"
    | "descricaoFonte"
    | "favorecidoFonte"
    | "statusFonte"
  > {
    return {
      workspaceId: entrada.workspaceId,
      fonte: entrada.fonte,
      provedor: entrada.provedor,
      idExterno:
        entrada.idExterno && sufixoIdExterno
          ? `${entrada.idExterno}:${sufixoIdExterno}`
          : entrada.idExterno,
      descricaoFonte: entrada.descricaoFonte ?? descricao,
      favorecidoFonte: entrada.favorecidoFonte,
      statusFonte: entrada.statusFonte,
    };
  }

  /**
   * Conta ou cartão conectado ao Open Finance só ganha Fato pelo sync. Vale para
   * qualquer chamador — chat, WhatsApp, Web, recorrência —, e é por isso que a
   * checagem mora aqui e não na montagem da resposta: uma política que vive na
   * borda protege apenas a borda que se lembrou dela.
   *
   * A exceção é a própria ingestão, que entra por `ingerir_eventos` e não passa
   * por aqui. A conciliação com lançamentos manuais do passado (ADR-010,
   * casamento na primeira sincronização) vai precisar da sua própria porta no
   * Core, pelo mesmo motivo: cancelar um manual em conta sincronizada é operação
   * do sistema, não do usuário.
   */
  private garantir_nao_sincronizada(
    origem: { nome: string; sincronizada: boolean },
    acao: "criar" | "corrigir" | "cancelar",
  ): void {
    if (origem.sincronizada) {
      throw new ErroContaSincronizada(origem.nome, acao);
    }
  }

  /**
   * Identidade estável para o hash: `conta_financeira_id` quando existir,
   * senão o id local da conta/cartão (também estável no reatachar).
   */
  private async identidade_fingerprint(
    evento: EventoFinanceiroNormalizado,
  ): Promise<string | null> {
    if (evento.fonte !== "open_finance") return null;
    if (evento.contaId) {
      const conta = await this.repositorio.obterConta(evento.contaId);
      return conta?.contaFinanceiraId ?? conta?.id ?? null;
    }
    if (evento.cartaoId) {
      const cartao = await this.repositorio.obterCartao(evento.cartaoId);
      return cartao?.contaFinanceiraId ?? cartao?.id ?? null;
    }
    return null;
  }

  private async gerar_fingerprint(
    evento: EventoFinanceiroNormalizado,
  ): Promise<string | null> {
    const identidadeId = await this.identidade_fingerprint(evento);
    if (!identidadeId) return null;
    return calcular_fingerprint_movimento({
      identidadeId,
      dataMovimento: evento.ocorridoEm,
      tipo: evento.tipo,
      valor: evento.valor,
      descricaoFonte: evento.descricaoFonte,
      favorecidoFonte: evento.favorecidoFonte,
    });
  }

  /**
   * Liga e desliga a marca de conta sincronizada. Mora aqui, ao lado da regra que
   * a lê, porque a marca muda o que o Core permite: deixar a Fonte escrever
   * direto na coluna espalharia por dois módulos a autoridade sobre a mesma
   * invariante.
   *
   * Ligar é decisão de peso — a conta passa a recusar lançamento manual, e os
   * lançamentos que já existiam nela ficam protegidos. Desligar devolve a conta
   * ao uso manual, mas **não** libera o que veio da instituição: Fato com fonte
   * `open_finance` continua imutável por si só, e é isso que impede desconectar
   * o banco de virar caminho para editar extrato.
   */
  async definir_sincronizacao(
    origem: { contaId?: string; cartaoId?: string },
    sincronizada: boolean,
  ): Promise<void> {
    if (!origem.contaId && !origem.cartaoId) {
      throw new ErroValidacaoFinanceira("Informe a conta ou o cartão a sincronizar.");
    }

    if (origem.contaId) {
      const conta = await this.repositorio.obterConta(origem.contaId);
      if (!conta) throw new ErroRecursoNaoEncontrado("conta", origem.contaId);
      await this.repositorio.definirSincronizacaoConta(origem.contaId, sincronizada);
    }

    if (origem.cartaoId) {
      const cartao = await this.repositorio.obterCartao(origem.cartaoId);
      if (!cartao) throw new ErroRecursoNaoEncontrado("cartao", origem.cartaoId);
      await this.repositorio.definirSincronizacaoCartao(origem.cartaoId, sincronizada);
    }
  }

  /**
   * Materializa conta/cartão do Core a partir de um recurso descoberto na Fonte.
   * A Fonte não é dona da entidade — só dispara a criação no Core.
   */
  async criar_conta_sincronizada(entrada: {
    workspaceId: string;
    usuarioId: string;
    nome: string;
    perfil: Conta["perfil"];
    saldoAtual?: number;
    conexaoId?: string | null;
  }): Promise<Conta> {
    return this.repositorio.criarContaSincronizada(entrada);
  }

  async criar_cartao_sincronizado(entrada: {
    workspaceId: string;
    usuarioId: string;
    nome: string;
    perfil: Cartao["perfil"];
    saldo?: number;
    limite?: number;
    fechamento?: number;
    vencimento?: number;
    conexaoId?: string | null;
  }): Promise<Cartao> {
    return this.repositorio.criarCartaoSincronizado(entrada);
  }

  async definir_conexao_identidade(
    destino: { contaId?: string; cartaoId?: string },
    conexaoId: string,
  ): Promise<void> {
    await this.repositorio.definirConexaoIdentidade(destino, conexaoId);
  }

  /**
   * Contas/cartões do workspace que já são OF (sync ligada) ou têm Fato da Fonte.
   * Usado para adotar órfãos na reconexão em vez de criar duplicata.
   */
  async listar_destinos_adotaveis(workspaceId: string): Promise<{
    contas: Conta[];
    cartoes: Cartao[];
  }> {
    const [contas, cartoes] = await Promise.all([
      this.repositorio.listarContasDoWorkspace(workspaceId),
      this.repositorio.listarCartoesDoWorkspace(workspaceId),
    ]);
    const fatos = await this.repositorio.idsComFatoOpenFinance({
      contaIds: contas.map((c) => c.id),
      cartaoIds: cartoes.map((c) => c.id),
    });
    const contasFato = new Set(fatos.contas);
    const cartoesFato = new Set(fatos.cartoes);
    return {
      contas: contas.filter((c) => c.sincronizada || contasFato.has(c.id)),
      cartoes: cartoes.filter((c) => c.sincronizada || cartoesFato.has(c.id)),
    };
  }

  async atualizar_dados_institucionais_cartao(
    cartaoId: string,
    dados: {
      nome?: string;
      saldo?: number;
      limite?: number;
      fechamento?: number;
      vencimento?: number;
    },
  ): Promise<void> {
    await this.repositorio.atualizarDadosInstitucionaisCartao(cartaoId, dados);
  }

  async atualizar_dados_institucionais_conta(
    contaId: string,
    dados: { saldoAtual?: number; nome?: string },
  ): Promise<void> {
    await this.repositorio.atualizarDadosInstitucionaisConta(contaId, dados);
  }

  /** Perfil PF/PJ da conta ou cartão — usado ao materializar irmãos na mesma conexão. */
  async obter_perfil(entrada: {
    contaId?: string | null;
    cartaoId?: string | null;
  }): Promise<"pf" | "pj" | undefined> {
    if (entrada.cartaoId) {
      const cartao = await this.repositorio.obterCartao(entrada.cartaoId);
      if (cartao?.perfil === "pf" || cartao?.perfil === "pj") return cartao.perfil;
    }
    if (entrada.contaId) {
      const conta = await this.repositorio.obterConta(entrada.contaId);
      if (conta?.perfil === "pf" || conta?.perfil === "pj") return conta.perfil;
    }
    return undefined;
  }

  /** Leitura usada pela projeção de parcelas Open Finance incompletas. */
  async listar_movimentos_parcelados_do_cartao(cartaoId: string) {
    return this.repositorio.listarMovimentosParceladosDoCartao(cartaoId);
  }

  /**
   * Entrada de movimentações vindas de uma Fonte Financeira (ADR-010). O Core
   * não sabe qual fonte é nem o que é "pluggy" — recebe eventos já normalizados
   * e obedece ao `fatoImutavel` que a fonte declarou.
   *
   * Idempotente por `idExterno`. O fingerprint é gravado para reidentificar
   * o Fato depois, quando o idExterno muda (reatachar) — ver `atualizar_fatos_da_fonte`.
   */
  async ingerir_eventos(
    eventos: EventoFinanceiroNormalizado[],
    contexto: ContextoIngestao,
  ): Promise<ResultadoIngestao> {
    const novosMovimentos: NovoMovimento[] = [];
    const auditorias: NovaAuditoria[] = [];
    const saldosPorConta = new Map<string, number>();
    let duplicados = 0;

    const perfilPorConta = new Map<string, "pf" | "pj">();
    const perfilPorCartao = new Map<string, "pf" | "pj">();

    for (const eventoBruto of eventos) {
      const evento = schemaEventoFinanceiroNormalizado.parse(eventoBruto);

      if (!evento.contaId && !evento.cartaoId) {
        throw new ErroValidacaoFinanceira(
          `Evento ${evento.idExterno ?? "sem identificador"} não indica conta nem cartão. ` +
            `A fonte precisa resolver a conta antes de entregar o evento ao Core.`,
        );
      }

      if (evento.idExterno) {
        const jaExiste = await this.repositorio.obterMovimentoPorIdExterno({
          workspaceId: evento.workspaceId,
          fonte: evento.fonte,
          provedor: evento.provedor,
          idExterno: evento.idExterno,
        });
        if (jaExiste) {
          duplicados += 1;
          continue;
        }
      }

      const fingerprint = await this.gerar_fingerprint(evento);

      const tipoGasto = await this.perfil_destino_ingestao(
        { contaId: evento.contaId, cartaoId: evento.cartaoId },
        contexto.perfilPadrao,
        perfilPorConta,
        perfilPorCartao,
      );

      const movimentoId = randomUUID();
      const novoMovimento: NovoMovimento = {
        id: movimentoId,
        workspaceId: evento.workspaceId,
        fonte: evento.fonte,
        provedor: evento.provedor,
        idExterno: evento.idExterno,
        fingerprint,
        descricaoFonte: evento.descricaoFonte,
        favorecidoFonte: evento.favorecidoFonte,
        statusFonte: evento.statusFonte,
        descricao: evento.descricaoFonte,
        valor: paraColuna(evento.valor),
        tipo: evento.tipo,
        status: evento.statusFonte === "pendente" ? "previsto" : "realizado",
        ...parcelamento_em_colunas(evento.parcelamento),
        tipoGasto,
        dataMovimento: evento.ocorridoEm,
        contaId: evento.contaId,
        cartaoId: evento.cartaoId,
        categoriaId: contexto.categoriaIdNaoClassificado,
        classificadoPor: "regra",
        usuarioId: contexto.usuarioId,
        criadoPor: contexto.criadoPor,
      };
      novosMovimentos.push(novoMovimento);

      // Conta sincronizada: o saldo é o `balance` da instituição (atribuído em
      // `atualizar_dados_institucionais_conta`), não a soma dos Fatos — ver
      // 13-OPEN_FINANCE §4. Acumular aqui inflava o saldo após cada importação.
      if (
        evento.fonte !== "open_finance" &&
        novoMovimento.status === "realizado" &&
        evento.contaId
      ) {
        const saldoBase =
          saldosPorConta.get(evento.contaId) ?? (await this.obter_saldo_atual(evento.contaId));
        saldosPorConta.set(evento.contaId, calcular_saldo(saldoBase, evento.tipo, evento.valor));
      }

      auditorias.push({
        tabela: "movimento",
        registroId: movimentoId,
        acao: "INSERCAO",
        estadoAnterior: null,
        estadoAtual: novoMovimento,
        alteradoPor: contexto.criadoPor,
      });
    }

    if (novosMovimentos.length === 0) {
      return { criados: [], duplicados };
    }

    const resultado = await this.repositorio.persistirOperacao({
      movimentos: novosMovimentos,
      parcelas: [],
      atualizacoesSaldoConta: [...saldosPorConta.entries()].map(([contaId, saldoAtual]) => ({
        contaId,
        saldoAtual,
      })),
      auditorias,
    });

    return { criados: resultado.movimentos, duplicados };
  }

  /**
   * Alteração anunciada pela instituição sobre Fato que já ingerimos — pendente
   * que virou confirmada, valor que o banco ajustou, descrição que ele reescreveu.
   *
   * Porta separada de `ingerir_eventos` de propósito. A janela de recoleta de 4 a
   * 7 dias faz o lote normal retrazer o que já entrou, e um `ingerir_eventos` que
   * também atualizasse reescreveria Fato a cada sincronização, escondendo a
   * mudança de verdade no meio do barulho. Aqui só entra o que a fonte declarou
   * ter mudado.
   *
   * Porta do **sistema**, não do usuário: é a exceção prevista em
   * [ADR-009](docs/adr/009-fato-vs-conhecimento.md), e a única forma de mexer em
   * Fato de `open_finance` sem passar por ela é escrever no banco à mão — o que o
   * trigger recusa.
   *
   * O Conhecimento não é tocado. Categoria, pessoa, tags, observações, tipo de gasto,
   * `ignorado_em_relatorio` e a `descricao` que o usuário vê seguem intactos: o
   * banco corrigiu o extrato dele, não a opinião do usuário sobre ele.
   */
  async atualizar_fatos_da_fonte(
    eventos: EventoFinanceiroNormalizado[],
    contexto: ContextoIngestao,
    opcoes: { reidentificarPorFingerprint?: boolean } = {},
  ): Promise<ResultadoAtualizacaoFonte> {
    const atualizacoes: OperacaoAtualizacaoFonte["atualizacoes"] = [];
    const auditorias: NovaAuditoria[] = [];
    const saldosPorConta = new Map<string, number>();
    const desconhecidos: EventoFinanceiroNormalizado[] = [];
    const reidentificados = new Set<string>();
    let inalterados = 0;

    for (const eventoBruto of eventos) {
      const evento = schemaEventoFinanceiroNormalizado.parse(eventoBruto);

      if (!evento.idExterno) {
        throw new ErroValidacaoFinanceira(
          "Alteração vinda da fonte exige idExterno: sem ele não há como saber o que mudou.",
        );
      }

      let atual = await this.repositorio.obterMovimentoPorIdExterno({
        workspaceId: evento.workspaceId,
        fonte: evento.fonte,
        provedor: evento.provedor,
        idExterno: evento.idExterno,
      });

      const fingerprint =
        evento.fonte === "open_finance" ? await this.gerar_fingerprint(evento) : null;

      if (!atual && fingerprint && opcoes.reidentificarPorFingerprint) {
        const candidatos = await this.repositorio.listarMovimentosPorFingerprint({
          workspaceId: evento.workspaceId,
          fonte: evento.fonte,
          provedor: evento.provedor,
          fingerprint,
        });
        atual = candidatos.find(
          (movimento) => movimento.status !== "cancelado" && !reidentificados.has(movimento.id),
        );
      }

      if (!atual) {
        desconhecidos.push(evento);
        continue;
      }

      reidentificados.add(atual.id);
      const campos = this.diferenca_do_fato(atual, evento);
      if (atual.idExterno !== evento.idExterno) {
        campos.idExterno = evento.idExterno;
      }
      if (fingerprint && atual.fingerprint !== fingerprint) {
        campos.fingerprint = fingerprint;
      }
      if (Object.keys(campos).length === 0) {
        inalterados += 1;
        continue;
      }

      const contaId = atual.contaId;
      // Mesma regra da ingestão: Fato de open_finance não mexe em saldo_atual.
      if (atual.fonte !== "open_finance" && contaId && !atual.cartaoId) {
        const saldoBase = saldosPorConta.get(contaId) ?? (await this.obter_saldo_atual(contaId));
        const delta =
          efeito_no_saldo({
            tipo: campos.tipo ?? atual.tipo,
            status: campos.status ?? atual.status,
            valor: campos.valor !== undefined ? paraNumero(campos.valor) : paraNumero(atual.valor),
          }) - efeito_no_saldo(atual);

        if (delta !== 0) saldosPorConta.set(contaId, arredondar(saldoBase + delta));
      }

      atualizacoes.push({ movimentoId: atual.id, campos });
      auditorias.push({
        tabela: "movimento",
        registroId: atual.id,
        acao: "ALTERACAO",
        estadoAnterior: atual,
        estadoAtual: { ...atual, ...campos },
        /**
         * Quem conectou o banco responde pela alteração, porque a coluna exige
         * um usuário existente. Que a mudança veio da instituição, e não de uma
         * pessoa, se lê no estado anterior e posterior: só campo de Fato mudou.
         */
        alteradoPor: contexto.criadoPor,
      });
    }

    if (atualizacoes.length === 0) {
      return { atualizados: [], desconhecidos, inalterados };
    }

    const atualizados = await this.repositorio.atualizarFatosDaFonte({
      atualizacoes,
      atualizacoesSaldoConta: [...saldosPorConta.entries()].map(([contaId, saldoAtual]) => ({
        contaId,
        saldoAtual,
      })),
      auditorias,
    });

    return { atualizados, desconhecidos, inalterados };
  }

  /**
   * A instituição desfez transações que aqui já são Fato — estorno de compra,
   * duplicata que ela mesma corrigiu, agendamento cancelado.
   *
   * O tratamento é **desaparecimento registrado**: `status_fonte` passa a
   * `removido`, que é o que a instituição afirma, e `status` passa a
   * `cancelado`, que é a consequência disso aqui. A linha fica no histórico.
   * Em `open_finance` o `saldo_atual` não é ajustado (é o balance institucional).
   *
   * As duas alternativas foram descartadas por motivo explícito. Apagar de
   * verdade contradiz o ADR-009 e destrói a auditoria de algo que existiu.
   * Ignorar deixa no relatório um gasto que o banco diz não existir — o pior
   * dos dois mundos, porque o número fica errado sem ninguém saber por quê.
   */
  async remover_fatos_da_fonte(
    remocoes: Array<{ workspaceId: string; fonte: TipoFonte; provedor?: string; idExterno: string }>,
    contexto: ContextoIngestao,
  ): Promise<ResultadoRemocaoFonte> {
    const atualizacoes: OperacaoAtualizacaoFonte["atualizacoes"] = [];
    const auditorias: NovaAuditoria[] = [];
    const saldosPorConta = new Map<string, number>();
    let desconhecidos = 0;
    let jaRemovidos = 0;

    for (const remocao of remocoes) {
      const atual = await this.repositorio.obterMovimentoPorIdExterno(remocao);

      if (!atual) {
        desconhecidos += 1;
        continue;
      }

      if (atual.statusFonte === "removido") {
        jaRemovidos += 1;
        continue;
      }

      const campos: Partial<NovoMovimento> = { statusFonte: "removido" };
      /**
       * Movimento que alguém já cancelou continua cancelado, e o saldo dele já
       * foi devolvido: registrar a remoção não pode devolver duas vezes.
       */
      if (atual.status !== "cancelado") campos.status = "cancelado";

      // Saldo institucional não é derivado dos Fatos; a próxima sync reatribui.
      if (atual.fonte !== "open_finance" && atual.contaId && !atual.cartaoId) {
        const saldoBase =
          saldosPorConta.get(atual.contaId) ?? (await this.obter_saldo_atual(atual.contaId));
        const delta = -efeito_no_saldo(atual);
        if (delta !== 0) saldosPorConta.set(atual.contaId, arredondar(saldoBase + delta));
      }

      atualizacoes.push({ movimentoId: atual.id, campos });
      auditorias.push({
        tabela: "movimento",
        registroId: atual.id,
        acao: "CANCELAMENTO",
        estadoAnterior: atual,
        estadoAtual: { ...atual, ...campos },
        alteradoPor: contexto.criadoPor,
      });
    }

    if (atualizacoes.length === 0) {
      return { removidos: [], desconhecidos, jaRemovidos };
    }

    const removidos = await this.repositorio.atualizarFatosDaFonte({
      atualizacoes,
      atualizacoesSaldoConta: [...saldosPorConta.entries()].map(([contaId, saldoAtual]) => ({
        contaId,
        saldoAtual,
      })),
      auditorias,
    });

    return { removidos, desconhecidos, jaRemovidos };
  }

  /**
   * Só os campos de Fato que realmente mudaram. Devolver o objeto inteiro faria
   * toda recoleta parecer alteração, e a auditoria encheria de linha sem
   * diferença nenhuma.
   */
  private diferenca_do_fato(
    atual: Movimento,
    evento: EventoFinanceiroNormalizado,
  ): Partial<NovoMovimento> {
    const campos: Partial<NovoMovimento> = {};

    const valorNovo = paraColuna(evento.valor);
    if (paraNumero(atual.valor) !== evento.valor) campos.valor = valorNovo;
    if (atual.tipo !== evento.tipo) campos.tipo = evento.tipo;
    if (atual.descricaoFonte !== evento.descricaoFonte) {
      campos.descricaoFonte = evento.descricaoFonte;
    }
    if ((atual.favorecidoFonte ?? undefined) !== evento.favorecidoFonte) {
      campos.favorecidoFonte = evento.favorecidoFonte;
    }
    if (atual.statusFonte !== evento.statusFonte) campos.statusFonte = evento.statusFonte;

    const statusNovo = evento.statusFonte === "pendente" ? "previsto" : "realizado";
    /**
     * Movimento cancelado não volta a valer por anúncio da fonte. Ressuscitar um
     * lançamento que alguém cancelou exigiria saber por que foi cancelado, e a
     * fonte não sabe.
     */
    if (atual.status !== statusNovo && atual.status !== "cancelado") {
      campos.status = statusNovo;
    }

    if (atual.dataMovimento !== evento.ocorridoEm) campos.dataMovimento = evento.ocorridoEm;

    /**
     * O parcelamento também é corrigido pela instituição — cartão que reprocessa
     * uma compra costuma reemitir as parcelas com valor diferente.
     */
    const parcelamento = parcelamento_em_colunas(evento.parcelamento);
    if (
      atual.parcelaNumero !== parcelamento.parcelaNumero ||
      atual.parcelaTotal !== parcelamento.parcelaTotal ||
      atual.parcelaCompraEm !== parcelamento.parcelaCompraEm ||
      atual.parcelaCompraValor !== parcelamento.parcelaCompraValor
    ) {
      Object.assign(campos, parcelamento);
    }

    return campos;
  }

  private async obter_saldo_atual(contaId: string): Promise<number> {
    const conta = await this.repositorio.obterConta(contaId);
    if (!conta) throw new ErroRecursoNaoEncontrado("conta", contaId);
    return paraNumero(conta.saldoAtual);
  }

  async criar_movimento(entradaBruta: EntradaCriarMovimento): Promise<ResultadoCriarMovimento> {
    const entrada = schemaCriarMovimento.parse(entradaBruta);

    const categoria = await this.repositorio.obterCategoria(entrada.categoriaId);
    if (!categoria) {
      throw new ErroRecursoNaoEncontrado("categoria", entrada.categoriaId);
    }

    if (entrada.pessoaId) {
      const pessoa = await this.repositorio.obterPessoa(entrada.pessoaId);
      if (!pessoa) {
        throw new ErroRecursoNaoEncontrado("pessoa", entrada.pessoaId);
      }
    }

    // “Não classificado” ainda não é escolha do usuário — regras/IA podem classificar depois.
    const classificadoPor = categoria_pendente(categoria.nome) ? "regra" : "usuario";

    if (entrada.tipo === "transferencia") {
      return this.criar_transferencia(entrada, classificadoPor);
    }

    if (entrada.cartaoId) {
      if (entrada.formaPagamento === "debito") {
        return this.criar_movimento_debito_cartao(entrada, classificadoPor);
      }
      return this.criar_movimento_credito_cartao(entrada, classificadoPor);
    }

    return this.criar_movimento_em_conta(entrada, classificadoPor);
  }

  private async criar_movimento_em_conta(
    entrada: EntradaCriarMovimento,
    classificadoPor: Movimento["classificadoPor"],
  ): Promise<ResultadoCriarMovimento> {
    if (!tipo_movimento_implementado(entrada.tipo)) {
      throw new ErroTipoMovimentoNaoImplementado(entrada.tipo);
    }

    const conta = await this.repositorio.obterConta(entrada.contaId as string);
    if (!conta) {
      throw new ErroRecursoNaoEncontrado("conta", entrada.contaId as string);
    }
    if (!conta.ativo) {
      throw new ErroValidacaoFinanceira(`Conta "${conta.nome}" está inativa.`);
    }
    this.garantir_nao_sincronizada(conta, "criar");

    const movimentoId = randomUUID();
    const novoMovimento: NovoMovimento = {
      id: movimentoId,
      descricao: entrada.descricao,
      valor: paraColuna(entrada.valor),
      tipo: entrada.tipo,
      status: entrada.status,
      tipoGasto: entrada.tipoGasto,
      formaPagamento: entrada.formaPagamento ?? "pix",
      dataMovimento: entrada.dataMovimento,
      contaId: conta.id,
      categoriaId: entrada.categoriaId,
      pessoaId: entrada.pessoaId,
      classificadoPor,
      usuarioId: entrada.usuarioId,
      criadoPor: entrada.criadoPor,
      ...this.campos_de_fato(entrada, entrada.descricao),
    };

    const atualizacoesSaldoConta = [];
    if (entrada.status === "realizado") {
      const saldoNovo = calcular_saldo(paraNumero(conta.saldoAtual), entrada.tipo, entrada.valor);
      atualizacoesSaldoConta.push({ contaId: conta.id, saldoAtual: saldoNovo });
    }

    const auditoria: NovaAuditoria = {
      tabela: "movimento",
      registroId: movimentoId,
      acao: "INSERCAO",
      estadoAnterior: null,
      estadoAtual: { ...novoMovimento, fluxoCruzado: eh_fluxo_cruzado(entrada.tipoGasto, conta.perfil) },
      alteradoPor: entrada.criadoPor,
    };

    return this.repositorio.persistirOperacao({
      movimentos: [novoMovimento],
      parcelas: [],
      atualizacoesSaldoConta,
      auditorias: [auditoria],
    });
  }

  /**
   * Transferência sempre gera duas linhas de `movimento` (débito na origem,
   * crédito no destino) na mesma operação atômica — não existe uma coluna
   * própria de "conta destino" no schema, então cada ponta é auto-suficiente
   * para o cálculo de saldo da sua respectiva conta.
   */
  private async criar_transferencia(
    entrada: EntradaCriarMovimento,
    classificadoPor: Movimento["classificadoPor"],
  ): Promise<ResultadoCriarMovimento> {
    const contaOrigem = await this.repositorio.obterConta(entrada.contaId as string);
    if (!contaOrigem) {
      throw new ErroRecursoNaoEncontrado("conta", entrada.contaId as string);
    }
    const contaDestino = await this.repositorio.obterConta(entrada.contaDestinoId as string);
    if (!contaDestino) {
      throw new ErroRecursoNaoEncontrado("conta", entrada.contaDestinoId as string);
    }
    if (contaOrigem.id === contaDestino.id) {
      throw new ErroValidacaoFinanceira("Conta de origem e destino não podem ser a mesma.");
    }
    // Basta uma ponta sincronizada: o banco vai informar aquele lado da
    // transferência, e registrar as duas à mão duplicaria metade dela.
    this.garantir_nao_sincronizada(contaOrigem, "criar");
    this.garantir_nao_sincronizada(contaDestino, "criar");

    const idOrigem = randomUUID();
    const idDestino = randomUUID();

    const formaTransferencia = entrada.formaPagamento ?? "transferencia";

    const descricaoOrigem = `${entrada.descricao} (enviado para ${contaDestino.nome})`;
    const descricaoDestino = `${entrada.descricao} (recebido de ${contaOrigem.nome})`;

    const movimentoOrigem: NovoMovimento = {
      id: idOrigem,
      descricao: descricaoOrigem,
      valor: paraColuna(entrada.valor),
      tipo: "transferencia",
      status: entrada.status,
      tipoGasto: entrada.tipoGasto,
      formaPagamento: formaTransferencia,
      dataMovimento: entrada.dataMovimento,
      contaId: contaOrigem.id,
      categoriaId: entrada.categoriaId,
      pessoaId: entrada.pessoaId,
      classificadoPor,
      usuarioId: entrada.usuarioId,
      criadoPor: entrada.criadoPor,
      // As duas pontas dividem um `idExterno`, que é único por linha; o sufixo
      // mantém a deduplicação funcionando sem perder a origem comum.
      ...this.campos_de_fato(entrada, descricaoOrigem, "origem"),
    };

    const movimentoDestino: NovoMovimento = {
      id: idDestino,
      descricao: descricaoDestino,
      valor: paraColuna(entrada.valor),
      tipo: "transferencia",
      status: entrada.status,
      tipoGasto: entrada.tipoGasto,
      formaPagamento: formaTransferencia,
      dataMovimento: entrada.dataMovimento,
      contaId: contaDestino.id,
      categoriaId: entrada.categoriaId,
      pessoaId: entrada.pessoaId,
      classificadoPor,
      usuarioId: entrada.usuarioId,
      criadoPor: entrada.criadoPor,
      ...this.campos_de_fato(entrada, descricaoDestino, "destino"),
    };

    const atualizacoesSaldoConta: Array<{ contaId: string; saldoAtual: number }> = [];
    if (entrada.status === "realizado") {
      atualizacoesSaldoConta.push(
        {
          contaId: contaOrigem.id,
          saldoAtual: calcular_saldo(paraNumero(contaOrigem.saldoAtual), "transferencia", entrada.valor, "origem"),
        },
        {
          contaId: contaDestino.id,
          saldoAtual: calcular_saldo(
            paraNumero(contaDestino.saldoAtual),
            "transferencia",
            entrada.valor,
            "destino",
          ),
        },
      );
    }

    const auditorias: NovaAuditoria[] = [
      {
        tabela: "movimento",
        registroId: idOrigem,
        acao: "INSERCAO",
        estadoAnterior: null,
        estadoAtual: movimentoOrigem,
        alteradoPor: entrada.criadoPor,
      },
      {
        tabela: "movimento",
        registroId: idDestino,
        acao: "INSERCAO",
        estadoAnterior: null,
        estadoAtual: movimentoDestino,
        alteradoPor: entrada.criadoPor,
      },
    ];

    return this.repositorio.persistirOperacao({
      movimentos: [movimentoOrigem, movimentoDestino],
      parcelas: [],
      atualizacoesSaldoConta,
      auditorias,
    });
  }

  /**
   * Compra no crédito: consome limite, gera parcelas, não mexe no saldo da conta.
   */
  private async criar_movimento_credito_cartao(
    entrada: EntradaCriarMovimento,
    classificadoPor: Movimento["classificadoPor"],
  ): Promise<ResultadoCriarMovimento> {
    if (!tipo_movimento_implementado(entrada.tipo)) {
      throw new ErroTipoMovimentoNaoImplementado(entrada.tipo);
    }

    const cartao = await this.repositorio.obterCartao(entrada.cartaoId as string);
    if (!cartao) {
      throw new ErroRecursoNaoEncontrado("cartao", entrada.cartaoId as string);
    }
    if (!cartao.ativo) {
      throw new ErroValidacaoFinanceira(`Cartão "${cartao.nome}" está inativo.`);
    }
    if (cartao.modalidade === "debito") {
      throw new ErroValidacaoFinanceira(
        `O cartão "${cartao.nome}" é só de débito. Use "no débito" ou cadastre um cartão de crédito/múltiplo.`,
      );
    }
    this.garantir_nao_sincronizada(cartao, "criar");

    const quantidadeParcelas = entrada.parcelamento?.quantidadeParcelas ?? 1;

    const comprometidoAtual = arredondar(
      (await this.repositorio.obterTotalComprometidoCartao(cartao.id)) + paraNumero(cartao.saldo),
    );
    const limite = paraNumero(cartao.limite);
    if (arredondar(comprometidoAtual + entrada.valor) > limite) {
      throw new ErroLimiteCartaoExcedido(cartao.nome, arredondar(limite - comprometidoAtual), entrada.valor);
    }

    const movimentoId = randomUUID();
    const novoMovimento: NovoMovimento = {
      id: movimentoId,
      descricao: entrada.descricao,
      valor: paraColuna(entrada.valor),
      tipo: entrada.tipo,
      status: entrada.status,
      tipoGasto: entrada.tipoGasto,
      formaPagamento: "credito",
      dataMovimento: entrada.dataMovimento,
      cartaoId: cartao.id,
      categoriaId: entrada.categoriaId,
      pessoaId: entrada.pessoaId,
      classificadoPor,
      usuarioId: entrada.usuarioId,
      criadoPor: entrada.criadoPor,
      ...this.campos_de_fato(entrada, entrada.descricao),
    };

    const parcelasCalculadas = registrar_parcelamento(
      entrada.valor,
      quantidadeParcelas,
      deISOParaData(entrada.dataMovimento),
      cartao,
    );

    const novasParcelas: NovaParcela[] = parcelasCalculadas.map((parcela) => ({
      id: randomUUID(),
      movimentoId,
      numeroParcela: parcela.numeroParcela,
      valor: paraColuna(parcela.valor),
      dataMovimento: parcela.dataMovimento,
      status: "previsto",
    }));

    const auditoria: NovaAuditoria = {
      tabela: "movimento",
      registroId: movimentoId,
      acao: "INSERCAO",
      estadoAnterior: null,
      estadoAtual: {
        ...novoMovimento,
        parcelas: novasParcelas,
        fluxoCruzado: eh_fluxo_cruzado(entrada.tipoGasto, cartao.perfil),
      },
      alteradoPor: entrada.criadoPor,
    };

    return this.repositorio.persistirOperacao({
      movimentos: [novoMovimento],
      parcelas: novasParcelas,
      atualizacoesSaldoConta: [],
      auditorias: [auditoria],
    });
  }

  /**
   * Compra no débito do cartão: baixa o saldo da conta vinculada na hora,
   * sem parcelas e sem consumir limite.
   */
  private async criar_movimento_debito_cartao(
    entrada: EntradaCriarMovimento,
    classificadoPor: Movimento["classificadoPor"],
  ): Promise<ResultadoCriarMovimento> {
    if (!tipo_movimento_implementado(entrada.tipo)) {
      throw new ErroTipoMovimentoNaoImplementado(entrada.tipo);
    }
    if (entrada.parcelamento) {
      throw new ErroValidacaoFinanceira("Parcelamento só é suportado em compras no crédito.");
    }

    const cartao = await this.repositorio.obterCartao(entrada.cartaoId as string);
    if (!cartao) {
      throw new ErroRecursoNaoEncontrado("cartao", entrada.cartaoId as string);
    }
    if (!cartao.ativo) {
      throw new ErroValidacaoFinanceira(`Cartão "${cartao.nome}" está inativo.`);
    }
    if (cartao.modalidade === "credito") {
      throw new ErroValidacaoFinanceira(
        `O cartão "${cartao.nome}" é só de crédito. Para usar débito, vincule uma conta a ele (fica múltiplo).`,
      );
    }
    if (!cartao.contaId) {
      throw new ErroValidacaoFinanceira(
        `O cartão "${cartao.nome}" não tem conta vinculada. Vincule uma conta para pagar no débito.`,
      );
    }

    const conta = await this.repositorio.obterConta(cartao.contaId);
    if (!conta) {
      throw new ErroRecursoNaoEncontrado("conta", cartao.contaId);
    }
    if (!conta.ativo) {
      throw new ErroValidacaoFinanceira(`Conta "${conta.nome}" vinculada ao cartão está inativa.`);
    }
    // A compra no débito baixa o saldo da conta vinculada, então quem manda é
    // ela: cartão não sincronizado ligado a conta sincronizada ainda duplicaria.
    this.garantir_nao_sincronizada(cartao, "criar");
    this.garantir_nao_sincronizada(conta, "criar");

    const movimentoId = randomUUID();
    const novoMovimento: NovoMovimento = {
      id: movimentoId,
      descricao: entrada.descricao,
      valor: paraColuna(entrada.valor),
      tipo: entrada.tipo,
      status: entrada.status,
      tipoGasto: entrada.tipoGasto,
      formaPagamento: "debito",
      dataMovimento: entrada.dataMovimento,
      cartaoId: cartao.id,
      contaId: conta.id,
      categoriaId: entrada.categoriaId,
      pessoaId: entrada.pessoaId,
      classificadoPor,
      usuarioId: entrada.usuarioId,
      criadoPor: entrada.criadoPor,
      ...this.campos_de_fato(entrada, entrada.descricao),
    };

    const atualizacoesSaldoConta = [];
    if (entrada.status === "realizado") {
      const saldoNovo = calcular_saldo(paraNumero(conta.saldoAtual), entrada.tipo, entrada.valor);
      atualizacoesSaldoConta.push({ contaId: conta.id, saldoAtual: saldoNovo });
    }

    const auditoria: NovaAuditoria = {
      tabela: "movimento",
      registroId: movimentoId,
      acao: "INSERCAO",
      estadoAnterior: null,
      estadoAtual: {
        ...novoMovimento,
        fluxoCruzado: eh_fluxo_cruzado(entrada.tipoGasto, cartao.perfil),
      },
      alteradoPor: entrada.criadoPor,
    };

    return this.repositorio.persistirOperacao({
      movimentos: [novoMovimento],
      parcelas: [],
      atualizacoesSaldoConta,
      auditorias: [auditoria],
    });
  }

  /**
   * Corrige o Fato de um lançamento manual (ex.: "corrige o combustível de ontem
   * para R$ 210", "muda o notebook de 10x pra 12x"). Nunca apaga o registro
   * anterior — grava auditoria e, quando necessário, ajusta saldo e regenera
   * parcelas (append-only: parcelas antigas ficam com status `cancelado`).
   *
   * Recusa qualquer alteração quando o Fato veio de instituição financeira.
   * Categoria, descrição, tags e afins não passam por aqui: são Conhecimento,
   * e vivem em `modulos/conhecimento`.
   */
  async corrigir_fato_manual(entradaBruta: EntradaCorrigirFatoManual): Promise<Movimento> {
    const entrada = schemaCorrigirFatoManual.parse(entradaBruta);

    const movimentoAtual = await this.repositorio.obterMovimento(entrada.movimentoId);
    if (!movimentoAtual) {
      throw new ErroRecursoNaoEncontrado("movimento", entrada.movimentoId);
    }
    if (movimentoAtual.fonte === "open_finance") {
      throw new ErroFatoImutavel(movimentoAtual.descricao);
    }
    if (movimentoAtual.status === "cancelado") {
      throw new ErroValidacaoFinanceira("Esse lançamento já está cancelado e não pode ser alterado.");
    }

    const campos = entrada.campos;
    await this.garantir_origem_do_movimento_editavel(
      movimentoAtual,
      campos.status === "cancelado" ? "cancelar" : "corrigir",
    );
    const camposParaAtualizar: Partial<NovoMovimento> = {};

    if (campos.dataMovimento !== undefined) camposParaAtualizar.dataMovimento = campos.dataMovimento;
    if (campos.status !== undefined) camposParaAtualizar.status = campos.status;
    if (campos.valor !== undefined) camposParaAtualizar.valor = paraColuna(campos.valor);
    if (campos.formaPagamento !== undefined) camposParaAtualizar.formaPagamento = campos.formaPagamento;

    if (campos.contaId !== undefined) {
      const conta = await this.repositorio.obterConta(campos.contaId);
      if (!conta) throw new ErroRecursoNaoEncontrado("conta", campos.contaId);
      camposParaAtualizar.contaId = campos.contaId;
    }
    if (campos.cartaoId !== undefined) {
      const cartao = await this.repositorio.obterCartao(campos.cartaoId);
      if (!cartao) throw new ErroRecursoNaoEncontrado("cartao", campos.cartaoId);
      camposParaAtualizar.cartaoId = campos.cartaoId;
    }

    camposParaAtualizar.alteradoPor = entrada.alteradoPor;

    const atualizacoesSaldoConta = await this.calcular_ajustes_saldo_na_correcao(movimentoAtual, campos);

    const regenerarParcelas = await this.preparar_regeneracao_parcelas(movimentoAtual, campos);

    const auditoria: NovaAuditoria = {
      tabela: "movimento",
      registroId: entrada.movimentoId,
      acao: campos.status === "cancelado" ? "CANCELAMENTO" : "ALTERACAO",
      estadoAnterior: movimentoAtual,
      estadoAtual: { ...movimentoAtual, ...camposParaAtualizar },
      alteradoPor: entrada.alteradoPor,
    };

    return this.repositorio.corrigirMovimento({
      movimentoId: entrada.movimentoId,
      campos: camposParaAtualizar,
      atualizacoesSaldoConta,
      auditoria,
      regenerarParcelas,
    });
  }

  /**
   * Porta de conciliação (primeira sync): cancela o lançamento manual/WhatsApp
   * que casou com um Fato do banco. Não passa por `garantir_nao_sincronizada` —
   * é operação do sistema, não do usuário. O Fato `open_finance` permanece;
   * a migração de Conhecimento fica no composition root.
   */
  async cancelar_para_conciliacao(entrada: {
    manualId: string;
    fatoId: string;
    alteradoPor: string;
  }): Promise<{ manual: Movimento; fato: Movimento }> {
    const manual = await this.repositorio.obterMovimento(entrada.manualId);
    if (!manual) throw new ErroRecursoNaoEncontrado("movimento", entrada.manualId);

    const fato = await this.repositorio.obterMovimento(entrada.fatoId);
    if (!fato) throw new ErroRecursoNaoEncontrado("movimento", entrada.fatoId);

    if (fato.fonte !== "open_finance") {
      throw new ErroValidacaoFinanceira("Conciliação exige um Fato vindo do banco.");
    }
    if (manual.fonte === "open_finance") {
      throw new ErroValidacaoFinanceira("Só lançamentos manuais ou do WhatsApp entram na conciliação.");
    }
    if (manual.status === "cancelado") {
      throw new ErroValidacaoFinanceira("Esse lançamento já está cancelado.");
    }
    if (manual.usuarioId !== fato.usuarioId || manual.workspaceId !== fato.workspaceId) {
      throw new ErroValidacaoFinanceira("Manual e Fato precisam ser do mesmo workspace.");
    }
    if (manual.contaId !== fato.contaId || manual.cartaoId !== fato.cartaoId) {
      throw new ErroValidacaoFinanceira("Manual e Fato precisam ser da mesma conta ou cartão.");
    }

    const campos: Partial<NovoMovimento> = {
      status: "cancelado",
      alteradoPor: entrada.alteradoPor,
    };
    const atualizacoesSaldoConta = await this.calcular_ajustes_saldo_na_correcao(manual, {
      status: "cancelado",
    });
    const regenerarParcelas = await this.preparar_regeneracao_parcelas(manual, {
      status: "cancelado",
    });

    const manualCancelado = await this.repositorio.corrigirMovimento({
      movimentoId: manual.id,
      campos,
      atualizacoesSaldoConta,
      auditoria: {
        tabela: "movimento",
        registroId: manual.id,
        acao: "CANCELAMENTO",
        estadoAnterior: manual,
        estadoAtual: { ...manual, ...campos },
        alteradoPor: entrada.alteradoPor,
      },
      regenerarParcelas,
    });

    return { manual: manualCancelado, fato };
  }

  /**
   * Um lançamento manual antigo pode estar numa conta que só depois foi
   * conectada ao banco. Dali em diante ele para de aceitar correção de Fato:
   * mexer no valor de algo que o extrato vai contradizer só cria divergência.
   * O Conhecimento continua livre, e é por lá que o usuário resolve o que quer.
   */
  private async garantir_origem_do_movimento_editavel(
    movimento: Movimento,
    acao: "corrigir" | "cancelar",
  ): Promise<void> {
    if (movimento.cartaoId) {
      const cartao = await this.repositorio.obterCartao(movimento.cartaoId);
      if (cartao) this.garantir_nao_sincronizada(cartao, acao);
    }
    if (movimento.contaId) {
      const conta = await this.repositorio.obterConta(movimento.contaId);
      if (conta) this.garantir_nao_sincronizada(conta, acao);
    }
  }

  /**
   * Calcula os deltas de `saldo_atual` necessários para a correção:
   * - mudança de valor na mesma conta;
   * - troca segura de conta (reverte na antiga, aplica na nova);
   * - cancelamento (reverte o efeito do lançamento realizado).
   * Movimentos em cartão / transferência não mexem em saldo de conta aqui.
   */
  private async calcular_ajustes_saldo_na_correcao(
    movimentoAtual: Movimento,
    campos: CamposFatoManual,
  ): Promise<Array<{ contaId: string; saldoAtual: number }>> {
    if (movimentoAtual.tipo === "transferencia" || movimentoAtual.cartaoId) {
      return [];
    }

    const direcao = obter_direcao_padrao(movimentoAtual.tipo);
    if (direcao === undefined) {
      throw new ErroTipoMovimentoNaoImplementado(movimentoAtual.tipo);
    }

    const valorAntigo = paraNumero(movimentoAtual.valor);
    const valorNovo = campos.valor ?? valorAntigo;
    const contaAntigaId = movimentoAtual.contaId;
    const contaNovaId = campos.contaId ?? contaAntigaId;
    const statusNovo = campos.status ?? movimentoAtual.status;
    const atualizacoes = new Map<string, number>();

    const obter_saldo_base = async (contaId: string): Promise<number> => {
      if (atualizacoes.has(contaId)) return atualizacoes.get(contaId) as number;
      const conta = await this.repositorio.obterConta(contaId);
      if (!conta) throw new ErroRecursoNaoEncontrado("conta", contaId);
      return paraNumero(conta.saldoAtual);
    };

    // Só mexe em saldo se o movimento estava (ou continua) realizado.
    if (movimentoAtual.status !== "realizado") {
      return [];
    }

    if (statusNovo === "cancelado") {
      if (contaAntigaId) {
        const saldo = await obter_saldo_base(contaAntigaId);
        atualizacoes.set(contaAntigaId, arredondar(saldo - direcao * valorAntigo));
      }
      return [...atualizacoes.entries()].map(([contaId, saldoAtual]) => ({ contaId, saldoAtual }));
    }

    if (contaAntigaId && contaNovaId && contaAntigaId !== contaNovaId) {
      const saldoAntiga = await obter_saldo_base(contaAntigaId);
      const saldoNova = await obter_saldo_base(contaNovaId);
      atualizacoes.set(contaAntigaId, arredondar(saldoAntiga - direcao * valorAntigo));
      atualizacoes.set(contaNovaId, arredondar(saldoNova + direcao * valorNovo));
      return [...atualizacoes.entries()].map(([contaId, saldoAtual]) => ({ contaId, saldoAtual }));
    }

    if (campos.valor !== undefined && contaNovaId) {
      const saldo = await obter_saldo_base(contaNovaId);
      atualizacoes.set(contaNovaId, arredondar(saldo + direcao * (valorNovo - valorAntigo)));
    }

    return [...atualizacoes.entries()].map(([contaId, saldoAtual]) => ({ contaId, saldoAtual }));
  }

  /**
   * Se o lançamento é no cartão e mudou valor, data, número de parcelas ou cartão,
   * cancela as parcelas antigas e gera um novo conjunto coerente com o cartão.
   */
  private async preparar_regeneracao_parcelas(
    movimentoAtual: Movimento,
    campos: CamposFatoManual,
  ): Promise<OperacaoCorrecao["regenerarParcelas"] | undefined> {
    const cartaoId = campos.cartaoId ?? movimentoAtual.cartaoId;
    if (!cartaoId) {
      if (campos.parcelas !== undefined) {
        throw new ErroValidacaoFinanceira("Só dá para alterar o número de parcelas de uma compra no cartão.");
      }
      return undefined;
    }

    const parcelasAtuais = await this.repositorio.listarParcelasDoMovimento(movimentoAtual.id);
    const precisaRegenerar =
      campos.valor !== undefined ||
      campos.dataMovimento !== undefined ||
      campos.parcelas !== undefined ||
      campos.cartaoId !== undefined ||
      campos.status === "cancelado";

    if (!precisaRegenerar || parcelasAtuais.length === 0) {
      return undefined;
    }

    if (campos.status === "cancelado") {
      return { novasParcelas: [] };
    }

    const cartao = await this.repositorio.obterCartao(cartaoId);
    if (!cartao) throw new ErroRecursoNaoEncontrado("cartao", cartaoId);

    const valorNovo = campos.valor ?? paraNumero(movimentoAtual.valor);
    const quantidade =
      campos.parcelas ?? (parcelasAtuais.length >= 2 ? parcelasAtuais.length : 1);
    const dataCompra = deISOParaData(campos.dataMovimento ?? movimentoAtual.dataMovimento);

    const parcelasCalculadas = registrar_parcelamento(valorNovo, quantidade, dataCompra, {
      fechamento: cartao.fechamento,
      vencimento: cartao.vencimento,
    });

    // Limite: desconsidera o comprometido deste próprio movimento (que será cancelado).
    const comprometidoAtual = arredondar(
      (await this.repositorio.obterTotalComprometidoCartao(cartaoId)) + paraNumero(cartao.saldo),
    );
    const comprometidoDesteMovimento = parcelasAtuais.reduce(
      (soma, parcela) => soma + paraNumero(parcela.valor),
      0,
    );
    const comprometidoSemEste = arredondar(comprometidoAtual - comprometidoDesteMovimento);
    const limite = paraNumero(cartao.limite);
    if (comprometidoSemEste + valorNovo > limite) {
      throw new ErroLimiteCartaoExcedido(cartao.nome, limite, comprometidoSemEste + valorNovo);
    }

    const novasParcelas: NovaParcela[] = parcelasCalculadas.map((parcela) => ({
      movimentoId: movimentoAtual.id,
      numeroParcela: parcela.numeroParcela,
      valor: paraColuna(parcela.valor),
      dataMovimento: parcela.dataMovimento,
      status: "previsto",
    }));

    return { novasParcelas };
  }

  /**
   * Perfil do movimento na ingestão: herda da conta/cartão destino.
   * `perfilPadrao` só entra se o destino não for encontrado.
   */
  private async perfil_destino_ingestao(
    destino: { contaId?: string | null; cartaoId?: string | null },
    fallback: "pf" | "pj",
    cacheConta: Map<string, "pf" | "pj">,
    cacheCartao: Map<string, "pf" | "pj">,
  ): Promise<"pf" | "pj"> {
    if (destino.cartaoId) {
      const emCache = cacheCartao.get(destino.cartaoId);
      if (emCache) return emCache;
      const cartao = await this.repositorio.obterCartao(destino.cartaoId);
      if (cartao?.perfil === "pf" || cartao?.perfil === "pj") {
        cacheCartao.set(destino.cartaoId, cartao.perfil);
        return cartao.perfil;
      }
    }
    if (destino.contaId) {
      const emCache = cacheConta.get(destino.contaId);
      if (emCache) return emCache;
      const conta = await this.repositorio.obterConta(destino.contaId);
      if (conta?.perfil === "pf" || conta?.perfil === "pj") {
        cacheConta.set(destino.contaId, conta.perfil);
        return conta.perfil;
      }
    }
    return fallback;
  }
}

function categoria_pendente(nome: string): boolean {
  return nome.toLocaleLowerCase("pt-BR") === CATEGORIA_NAO_CLASSIFICADO.toLocaleLowerCase("pt-BR");
}
