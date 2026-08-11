import type { MotorFinanceiro } from "@lancai/financeiro";
import {
  ErroAssociacaoInvalida,
  ErroConexaoNaoEncontrada,
  ErroContaExternaNaoEncontrada,
  ErroProvedorIndisponivel,
} from "./erros";
import type { ContaExterna, EstadoConexao, ProvedorOpenFinance, TokenConexao } from "./provedor";
import type {
  ConexaoDetalhada,
  ContaExternaRegistrada,
  RepositorioOpenFinance,
} from "./repositorio";
import { recurso_externo_eh_cartao } from "./tipo-recurso";

/**
 * O que o Web precisa saber para abrir o widget, sem saber qual provedor é.
 * É este descritor que impede o nome do provedor de virar `if` no frontend:
 * o `id` é rótulo opaco e serve só para o Web escolher qual widget carregar.
 */
export interface DescritorFonte {
  id: string;
  disponivel: boolean;
}

export interface ConexaoComContas {
  conexao: ConexaoDetalhada;
  contas: ContaExternaRegistrada[];
}

/**
 * O ciclo de vida de uma conexão: abrir o widget, registrar o que o usuário
 * conectou, e associar cada conta do banco a uma conta daqui.
 *
 * A ingestão é outro serviço de propósito. Esta parte é iniciada por uma pessoa
 * numa tela; aquela é iniciada pelo provedor, sem ninguém olhando. Juntar as
 * duas num objeto só misturaria dois ritmos e dois modos de falha.
 */
export class ServicoConexaoOpenFinance {
  constructor(
    private readonly provedor: ProvedorOpenFinance,
    private readonly repositorio: RepositorioOpenFinance,
    private readonly motor: MotorFinanceiro,
  ) {}

  descrever_fonte(): DescritorFonte {
    return { id: this.provedor.id, disponivel: true };
  }

  /**
   * Passo 2 do fluxo de conexão: o token de curta duração que o Web usa para
   * abrir o widget. Ele não lê dados — a credencial que lê fica no backend.
   */
  async iniciar_conexao(entrada: {
    usuarioId: string;
    /** Preenchido quando é reconexão de uma conexão que precisa de atenção. */
    conexaoId?: string;
  }): Promise<TokenConexao> {
    const conexaoExterna = entrada.conexaoId
      ? (await this.exigir_conexao(entrada.conexaoId)).idExterno
      : undefined;

    return this.provedor.criar_token_conexao({
      usuarioId: entrada.usuarioId,
      conexaoExterna,
    });
  }

  /**
   * Passo 5: o widget terminou e devolveu o identificador da conexão. Grava a
   * conexão, traz os recursos encontrados e materializa Conta/Cartão no Core
   * para cada recurso ainda sem destino local.
   *
   * É idempotente: reabrir o widget na mesma instituição atualiza a conexão que
   * já existe em vez de criar outra; associações existentes são preservadas.
   */
  async registrar_conexao(entrada: {
    workspaceId: string;
    usuarioId: string;
    conexaoExterna: string;
  }): Promise<ConexaoComContas> {
    const estado = await this.provedor.obter_estado(entrada.conexaoExterna);

    const conexao = await this.repositorio.registrarConexao({
      provedor: this.provedor.id,
      idExterno: entrada.conexaoExterna,
      workspaceId: entrada.workspaceId,
      criadoPor: entrada.usuarioId,
      instituicao: estado.instituicao ?? null,
    });

    await this.repositorio.atualizarEstadoConexao(conexao.id, this.traduzir_estado(estado));

    const encontradas = await this.provedor.listar_contas_externas(entrada.conexaoExterna);
    await this.repositorio.sincronizarContasExternas(
      conexao.id,
      encontradas.map((conta: ContaExterna) => ({
        contaExternaId: conta.idExterno,
        nome: conta.nome,
        tipo: conta.tipo,
      })),
    );

    await this.materializar_recursos_sem_destino({
      conexaoId: conexao.id,
      workspaceId: entrada.workspaceId,
      usuarioId: entrada.usuarioId,
      perfil: conexao.perfilPadrao,
      encontradas,
      instituicao: estado.instituicao ?? null,
    });

    await this.aplicar_saldos_institucionais(conexao.id, encontradas);

    return this.detalhar(conexao.id);
  }

  async listar_conexoes(workspaceIds: string | string[]): Promise<ConexaoDetalhada[]> {
    return this.repositorio.listarConexoes(workspaceIds);
  }

  /** Conexões não removidas do provedor ativo — usadas pelo cron de importação GET. */
  async listar_conexoes_importaveis(limite: number): Promise<ConexaoDetalhada[]> {
    return this.repositorio.listarConexoesImportaveis({
      provedor: this.provedor.id,
      limite,
    });
  }

  /**
   * Atualiza saldo/limite a partir do snapshot atual no provedor, sem pedir sync
   * (sem PATCH). Usado pelo cron de importação e por fluxos que só precisam ler.
   */
  async atualizar_saldos(conexaoId: string): Promise<void> {
    const conexao = await this.exigir_conexao(conexaoId);
    if (conexao.status === "removida") return;
    const encontradas = await this.provedor.listar_contas_externas(conexao.idExterno);
    await this.aplicar_saldos_institucionais(conexaoId, encontradas);
  }

  async detalhar(conexaoId: string): Promise<ConexaoComContas> {
    const conexao = await this.exigir_conexao(conexaoId);
    return { conexao, contas: await this.repositorio.listarContasExternas(conexaoId) };
  }

  /**
   * Passos 6 e 7: liga a conta do banco a uma conta ou cartão local e marca a
   * origem como sincronizada.
   *
   * Marcar é o que muda o comportamento do sistema inteiro — a conta passa a
   * recusar lançamento manual em qualquer canal —, e por isso quem marca é o
   * Core, não este módulo. Ver `MotorFinanceiro.definir_sincronizacao`.
   */
  async associar(entrada: {
    conexaoId: string;
    contaExternaId: string;
    contaId?: string;
    cartaoId?: string;
  }): Promise<ConexaoComContas> {
    if (!entrada.contaId && !entrada.cartaoId) {
      throw new ErroAssociacaoInvalida("Informe a conta ou o cartão local.");
    }
    if (entrada.contaId && entrada.cartaoId) {
      throw new ErroAssociacaoInvalida(
        "Uma conta do banco vira conta ou cartão aqui, não os dois: " +
          "a movimentação precisa de um destino só.",
      );
    }

    await this.exigir_conexao(entrada.conexaoId);
    await this.exigir_conta_externa(entrada.conexaoId, entrada.contaExternaId);

    /**
     * O Core valida que a conta existe e é ele quem marca. Vem antes de gravar o
     * mapa de propósito: se a conta local não existir, nada é associado.
     */
    await this.motor.definir_sincronizacao(
      { contaId: entrada.contaId, cartaoId: entrada.cartaoId },
      true,
    );

    await this.repositorio.definirAssociacao(entrada.conexaoId, entrada.contaExternaId, {
      contaId: entrada.contaId ?? null,
      cartaoId: entrada.cartaoId ?? null,
    });

    return this.detalhar(entrada.conexaoId);
  }

  /**
   * “Atualizar agora”:
   * 1) refresca saldo/limite com o snapshot atual da instituição (sempre);
   * 2) pede sync pontual — best-effort: a Pluggy recusa com frequência
   *    (já atualizando / limite de 1h / item Meu Pluggy que só synca no app).
   * Extrato novo: importação GET no request da API (e webhook, quando chegar).
   */
  async solicitar_atualizacao(conexaoId: string): Promise<ConexaoComContas> {
    const conexao = await this.exigir_conexao(conexaoId);
    if (conexao.status === "removida") {
      throw new ErroAssociacaoInvalida("Esta conexão foi removida e não pode ser atualizada.");
    }

    const encontradas = await this.provedor.listar_contas_externas(conexao.idExterno);
    await this.aplicar_saldos_institucionais(conexaoId, encontradas);

    try {
      await this.provedor.solicitar_atualizacao(conexao.idExterno);
      await this.repositorio.atualizarEstadoConexao(conexaoId, {
        status: "sincronizando",
        motivoAtencao: null,
      });
    } catch (erro) {
      if (!(erro instanceof ErroProvedorIndisponivel)) throw erro;
      /**
       * Sync recusado não é falha da ação: o snapshot de saldo/limite já foi
       * aplicado. Extrato continua o que já tínhamos até o próximo sync aceito.
       */
    }

    return this.detalhar(conexaoId);
  }

  /**
   * Desfaz a associação e devolve a conta local ao uso manual. O que já entrou
   * pela instituição continua imutável: Fato com fonte `open_finance` é
   * protegido por si só, então desconectar não vira caminho para editar extrato.
   */
  async desassociar(entrada: {
    conexaoId: string;
    contaExternaId: string;
  }): Promise<ConexaoComContas> {
    await this.exigir_conexao(entrada.conexaoId);
    const conta = await this.exigir_conta_externa(entrada.conexaoId, entrada.contaExternaId);

    if (conta.contaId || conta.cartaoId) {
      await this.motor.definir_sincronizacao(
        { contaId: conta.contaId ?? undefined, cartaoId: conta.cartaoId ?? undefined },
        false,
      );
    }

    await this.repositorio.definirAssociacao(entrada.conexaoId, entrada.contaExternaId, {
      contaId: null,
      cartaoId: null,
    });

    return this.detalhar(entrada.conexaoId);
  }

  /**
   * Desconecta a instituição: marca a conexão como removida e desliga sync
   * das contas/cartões. Histórico e entidades locais permanecem.
   */
  async desconectar(conexaoId: string): Promise<ConexaoComContas> {
    const conexao = await this.exigir_conexao(conexaoId);
    if (conexao.status === "removida") {
      return this.detalhar(conexaoId);
    }

    await this.desligar_recursos_da_conexao(conexaoId);

    await this.repositorio.atualizarEstadoConexao(conexaoId, {
      status: "removida",
      motivoAtencao: null,
    });

    return this.detalhar(conexaoId);
  }

  /**
   * Excluir no Core uma conta/cartão sincronizado: desliga a conexão inteira
   * (conta + cartões da mesma instituição) e devolve os IDs locais para
   * soft-delete. Sem associação OF, devolve só o destino pedido.
   */
  async excluir_por_destino(destino: {
    contaId?: string;
    cartaoId?: string;
  }): Promise<{
    conexaoId: string | null;
    contaIds: string[];
    cartaoIds: string[];
  }> {
    if (!destino.contaId && !destino.cartaoId) {
      return { conexaoId: null, contaIds: [], cartaoIds: [] };
    }

    const conexaoId = await this.repositorio.encontrarConexaoIdPorDestino(destino);
    if (!conexaoId) {
      return {
        conexaoId: null,
        contaIds: destino.contaId ? [destino.contaId] : [],
        cartaoIds: destino.cartaoId ? [destino.cartaoId] : [],
      };
    }

    const recursos = await this.repositorio.listarContasExternas(conexaoId);
    const contaIds = new Set<string>();
    const cartaoIds = new Set<string>();
    for (const recurso of recursos) {
      if (recurso.contaId) contaIds.add(recurso.contaId);
      if (recurso.cartaoId) cartaoIds.add(recurso.cartaoId);
    }
    if (destino.contaId) contaIds.add(destino.contaId);
    if (destino.cartaoId) cartaoIds.add(destino.cartaoId);

    await this.desligar_recursos_da_conexao(conexaoId);
    await this.repositorio.apagarConexao(conexaoId);

    return {
      conexaoId,
      contaIds: [...contaIds],
      cartaoIds: [...cartaoIds],
    };
  }

  private async desligar_recursos_da_conexao(conexaoId: string): Promise<void> {
    const contas = await this.repositorio.listarContasExternas(conexaoId);
    for (const conta of contas) {
      if (conta.contaId || conta.cartaoId) {
        await this.motor.definir_sincronizacao(
          { contaId: conta.contaId ?? undefined, cartaoId: conta.cartaoId ?? undefined },
          false,
        );
        await this.repositorio.definirAssociacao(conexaoId, conta.contaExternaId, {
          contaId: null,
          cartaoId: null,
        });
      }
    }
  }

  /**
   * Para cada recurso externo sem destino, cria Conta ou Cartão no Core e associa.
   */
  private async materializar_recursos_sem_destino(entrada: {
    conexaoId: string;
    workspaceId: string;
    usuarioId: string;
    perfil: "pf" | "pj";
    encontradas: ContaExterna[];
    instituicao: string | null;
  }): Promise<void> {
    const registradas = await this.repositorio.listarContasExternas(entrada.conexaoId);
    const porExterno = new Map(entrada.encontradas.map((item) => [item.idExterno, item] as const));
    let perfilHerdado =
      (await this.perfil_de_irmaos_na_conexao(registradas)) ?? entrada.perfil;

    for (const recurso of registradas) {
      if (recurso.contaId || recurso.cartaoId) continue;

      const nome =
        recurso.nome.trim() ||
        entrada.instituicao?.trim() ||
        (recurso_externo_eh_cartao(recurso.tipo) ? "Cartão sincronizado" : "Conta sincronizada");
      const externa = porExterno.get(recurso.contaExternaId);

      if (recurso_externo_eh_cartao(recurso.tipo)) {
        const cartao = await this.motor.criar_cartao_sincronizado({
          workspaceId: entrada.workspaceId,
          usuarioId: entrada.usuarioId,
          nome,
          perfil: perfilHerdado,
          saldo: numero_finito(externa?.saldo) ?? 0,
          limite: numero_finito(externa?.limite) ?? 0,
          fechamento: externa?.fechamento,
          vencimento: externa?.vencimento,
        });
        await this.repositorio.definirAssociacao(entrada.conexaoId, recurso.contaExternaId, {
          contaId: null,
          cartaoId: cartao.id,
        });
        perfilHerdado = cartao.perfil;
        continue;
      }

      const conta = await this.motor.criar_conta_sincronizada({
        workspaceId: entrada.workspaceId,
        usuarioId: entrada.usuarioId,
        nome,
        perfil: perfilHerdado,
        saldoAtual: numero_finito(externa?.saldo) ?? 0,
      });
      await this.repositorio.definirAssociacao(entrada.conexaoId, recurso.contaExternaId, {
        contaId: conta.id,
        cartaoId: null,
      });
      perfilHerdado = conta.perfil;
    }
  }

  /** Se a conexão já tem conta/cartão associado, novos recursos herdam o perfil. */
  private async perfil_de_irmaos_na_conexao(
    registradas: ContaExternaRegistrada[],
  ): Promise<"pf" | "pj" | undefined> {
    for (const recurso of registradas) {
      if (!recurso.contaId && !recurso.cartaoId) continue;
      const perfil = await this.motor.obter_perfil({
        contaId: recurso.contaId,
        cartaoId: recurso.cartaoId,
      });
      if (perfil) return perfil;
    }
    return undefined;
  }

  /**
   * Espelha saldo/limite/ciclo da instituição nas contas e cartões já associados.
   * Cobre cartões criados antes do mapeamento de creditData (saldo/limite zerados).
   */
  private async aplicar_saldos_institucionais(
    conexaoId: string,
    encontradas: ContaExterna[],
  ): Promise<void> {
    const registradas = await this.repositorio.listarContasExternas(conexaoId);
    const porExterno = new Map(encontradas.map((item) => [item.idExterno, item] as const));

    for (const recurso of registradas) {
      const externa = porExterno.get(recurso.contaExternaId);
      if (!externa) continue;

      if (recurso.cartaoId) {
        await this.motor.atualizar_dados_institucionais_cartao(recurso.cartaoId, {
          nome: externa.nome,
          saldo: numero_finito(externa.saldo),
          limite: numero_finito(externa.limite),
          fechamento: externa.fechamento,
          vencimento: externa.vencimento,
        });
      }

      if (recurso.contaId) {
        await this.motor.atualizar_dados_institucionais_conta(recurso.contaId, {
          nome: externa.nome,
          saldoAtual: numero_finito(externa.saldo),
        });
      }
    }
  }

  private traduzir_estado(estado: EstadoConexao) {
    return {
      status: estado.status,
      motivoAtencao: estado.motivoAtencao ?? null,
      instituicao: estado.instituicao ?? null,
      consentimentoExpiraEm: estado.consentimentoExpiraEm ?? null,
    };
  }

  private async exigir_conexao(conexaoId: string): Promise<ConexaoDetalhada> {
    const conexao = await this.repositorio.obterConexaoPorId(conexaoId);
    if (!conexao) throw new ErroConexaoNaoEncontrada(conexaoId);
    return conexao;
  }

  private async exigir_conta_externa(
    conexaoId: string,
    contaExternaId: string,
  ): Promise<ContaExternaRegistrada> {
    const contas = await this.repositorio.listarContasExternas(conexaoId);
    const conta = contas.find((c) => c.contaExternaId === contaExternaId);
    if (!conta) throw new ErroContaExternaNaoEncontrada(contaExternaId);
    return conta;
  }
}

function numero_finito(valor: number | undefined): number | undefined {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : undefined;
}
