import type { MotorFinanceiro } from "@lancai/financeiro";
import {
  ErroAssociacaoInvalida,
  ErroConexaoNaoEncontrada,
  ErroContaExternaNaoEncontrada,
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
    workspaceId: string;
    /** Preenchido quando é reconexão de uma conexão que precisa de atenção. */
    conexaoId?: string;
  }): Promise<TokenConexao> {
    const conexaoExterna = entrada.conexaoId
      ? (await this.exigir_conexao(entrada.conexaoId)).idExterno
      : undefined;

    return this.provedor.criar_token_conexao({
      workspaceId: entrada.workspaceId,
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

    return this.detalhar(conexao.id);
  }

  async listar_conexoes(workspaceIds: string | string[]): Promise<ConexaoDetalhada[]> {
    return this.repositorio.listarConexoes(workspaceIds);
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
   * “Atualizar agora”: pede sync pontual ao provedor. O extrato novo chega
   * depois, por webhook — aqui só marcamos `sincronizando` para a UI.
   */
  async solicitar_atualizacao(conexaoId: string): Promise<ConexaoComContas> {
    const conexao = await this.exigir_conexao(conexaoId);
    if (conexao.status === "removida") {
      throw new ErroAssociacaoInvalida("Esta conexão foi removida e não pode ser atualizada.");
    }

    await this.provedor.solicitar_atualizacao(conexao.idExterno);
    await this.repositorio.atualizarEstadoConexao(conexaoId, {
      status: "sincronizando",
      motivoAtencao: null,
    });

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

    await this.repositorio.atualizarEstadoConexao(conexaoId, {
      status: "removida",
      motivoAtencao: null,
    });

    return this.detalhar(conexaoId);
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
    const saldoPorExterno = new Map(
      entrada.encontradas.map((item) => [item.idExterno, item.saldo] as const),
    );

    for (const recurso of registradas) {
      if (recurso.contaId || recurso.cartaoId) continue;

      const nome =
        recurso.nome.trim() ||
        entrada.instituicao?.trim() ||
        (recurso_externo_eh_cartao(recurso.tipo) ? "Cartão sincronizado" : "Conta sincronizada");

      if (recurso_externo_eh_cartao(recurso.tipo)) {
        const cartao = await this.motor.criar_cartao_sincronizado({
          workspaceId: entrada.workspaceId,
          usuarioId: entrada.usuarioId,
          nome,
          perfil: entrada.perfil,
        });
        await this.repositorio.definirAssociacao(entrada.conexaoId, recurso.contaExternaId, {
          contaId: null,
          cartaoId: cartao.id,
        });
        continue;
      }

      const saldo = saldoPorExterno.get(recurso.contaExternaId);
      const conta = await this.motor.criar_conta_sincronizada({
        workspaceId: entrada.workspaceId,
        usuarioId: entrada.usuarioId,
        nome,
        perfil: entrada.perfil,
        saldoAtual: typeof saldo === "number" && Number.isFinite(saldo) ? saldo : 0,
      });
      await this.repositorio.definirAssociacao(entrada.conexaoId, recurso.contaExternaId, {
        contaId: conta.id,
        cartaoId: null,
      });
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
