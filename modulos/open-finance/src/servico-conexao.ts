import type { MotorFinanceiro } from "@lancai/financeiro";
import {
  ErroAssociacaoInvalida,
  ErroConexaoExternaInexistente,
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

export interface RecursosVinculados {
  quantidade: number;
  nomes: string[];
}

export interface ConexaoListada extends ConexaoDetalhada {
  contasVinculadas: RecursosVinculados;
  cartoesVinculados: RecursosVinculados;
}

export interface ConexaoComContas {
  conexao: ConexaoListada;
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

    await this.adotar_locais_orfos({
      conexaoId: conexao.id,
      workspaceId: entrada.workspaceId,
      encontradas,
    });

    await this.materializar_recursos_sem_destino({
      conexaoId: conexao.id,
      workspaceId: entrada.workspaceId,
      usuarioId: entrada.usuarioId,
      perfil: conexao.perfilPadrao,
      encontradas,
      instituicao: estado.instituicao ?? null,
    });

    await this.religar_recursos_da_conexao(conexao.id);
    await this.aplicar_saldos_institucionais(conexao.id, encontradas);

    return this.detalhar(conexao.id);
  }

  async listar_conexoes(workspaceIds: string | string[]): Promise<ConexaoListada[]> {
    const conexoes = await this.repositorio.listarConexoes(workspaceIds);
    return Promise.all(conexoes.map((conexao) => this.com_vinculos(conexao)));
  }

  /** Conexões não removidas do provedor ativo — usadas pelo cron de importação GET. */
  async listar_conexoes_importaveis(limite: number): Promise<ConexaoDetalhada[]> {
    return this.repositorio.listarConexoesImportaveis({
      provedor: this.provedor.id,
      limite,
    });
  }

  /**
   * Mesmo primeiro passo do conectar: GET /items/{idExterno}.
   * Item existe → não regrava conexão nem extrato. Item sumiu → `removida`.
   * 5xx/429 sobem para o chamador (não mudam status).
   */
  async verificar_item_salvo(conexaoId: string): Promise<boolean> {
    const conexao = await this.exigir_conexao(conexaoId);
    if (conexao.status === "removida") return false;
    try {
      await this.provedor.obter_estado(conexao.idExterno);
      return true;
    } catch (erro) {
      if (await this.marcar_removida_se_inexistente(conexaoId, erro)) return false;
      throw erro;
    }
  }

  /**
   * Atualiza saldo/limite a partir do snapshot atual no provedor, sem pedir sync
   * (sem PATCH). Usado pelo cron de importação e por fluxos que só precisam ler.
   */
  async atualizar_saldos(conexaoId: string): Promise<void> {
    const conexao = await this.exigir_conexao(conexaoId);
    if (conexao.status === "removida") return;
    try {
      const encontradas = await this.provedor.listar_contas_externas(conexao.idExterno);
      await this.aplicar_saldos_institucionais(conexaoId, encontradas);
    } catch (erro) {
      await this.marcar_removida_se_inexistente(conexaoId, erro);
      throw erro;
    }
  }

  async detalhar(conexaoId: string): Promise<ConexaoComContas> {
    const conexao = await this.exigir_conexao(conexaoId);
    const contas = await this.repositorio.listarContasExternas(conexaoId);
    return { conexao: this.com_vinculos_de(conexao, contas), contas };
  }

  /**
   * Lê estado e recursos de um itemId no provedor **sem** gravar conexão.
   * Usado pelo wizard de reconectar quando o auto-match é ambíguo.
   */
  async inspecionar_item(conexaoExterna: string): Promise<{
    instituicao: string | null;
    status: EstadoConexao["status"];
    contas: ContaExterna[];
  }> {
    const estado = await this.provedor.obter_estado(conexaoExterna);
    const contas = await this.provedor.listar_contas_externas(conexaoExterna);
    return {
      instituicao: estado.instituicao ?? null,
      status: estado.status,
      contas,
    };
  }

  /**
   * Reconecta: com `conexaoId`, atualiza o itemId in-place; sem, registra (ou
   * reusa) a conexão do item e **adota** conta/cartão local órfão (alvo, nome+tipo)
   * em vez de duplicar. Só materializa o que for realmente novo.
   */
  async reatachar_conexao(entrada: {
    workspaceId: string;
    usuarioId: string;
    conexaoExterna: string;
    pareamentos?: Array<{
      contaExternaId: string;
      contaId?: string;
      cartaoId?: string;
    }>;
    conexaoId?: string;
    conexaoIdAnterior?: string;
    alvoContaId?: string;
    alvoCartaoId?: string;
  }): Promise<ConexaoComContas> {
    const pareamentos = entrada.pareamentos ?? [];
    for (const p of pareamentos) {
      if (!p.contaId && !p.cartaoId) {
        throw new ErroAssociacaoInvalida(
          `Pareamento de ${p.contaExternaId}: informe contaId ou cartaoId.`,
        );
      }
      if (p.contaId && p.cartaoId) {
        throw new ErroAssociacaoInvalida(
          `Pareamento de ${p.contaExternaId}: conta ou cartão, não os dois.`,
        );
      }
    }

    let conexaoId = entrada.conexaoId ?? entrada.conexaoIdAnterior;
    let encontradas: ContaExterna[];
    let instituicao: string | null;
    let perfil: "pf" | "pj";

    if (conexaoId) {
      const conexao = await this.exigir_conexao(conexaoId);
      perfil = conexao.perfilPadrao;
      const aplicado = await this.aplicar_novo_item(conexaoId, entrada.conexaoExterna);
      encontradas = aplicado.encontradas;
      instituicao = aplicado.instituicao;
      await this.rematch_contas_externas(
        conexaoId,
        new Set(encontradas.map((c) => c.idExterno)),
      );
    } else {
      const estado = await this.provedor.obter_estado(entrada.conexaoExterna);
      const conexao = await this.repositorio.registrarConexao({
        provedor: this.provedor.id,
        idExterno: entrada.conexaoExterna,
        workspaceId: entrada.workspaceId,
        criadoPor: entrada.usuarioId,
        instituicao: estado.instituicao ?? null,
      });
      conexaoId = conexao.id;
      perfil = conexao.perfilPadrao;
      await this.repositorio.atualizarEstadoConexao(conexao.id, this.traduzir_estado(estado));
      encontradas = await this.provedor.listar_contas_externas(entrada.conexaoExterna);
      instituicao = estado.instituicao ?? null;
      await this.repositorio.sincronizarContasExternas(
        conexaoId,
        encontradas.map((conta: ContaExterna) => ({
          contaExternaId: conta.idExterno,
          nome: conta.nome,
          tipo: conta.tipo,
        })),
      );
    }

    await this.adotar_locais_orfos({
      conexaoId,
      workspaceId: entrada.workspaceId,
      encontradas,
      alvoContaId: entrada.alvoContaId,
      alvoCartaoId: entrada.alvoCartaoId,
    });

    const idsNoProvedor = new Set(encontradas.map((c) => c.idExterno));
    for (const p of pareamentos) {
      if (!idsNoProvedor.has(p.contaExternaId)) {
        throw new ErroContaExternaNaoEncontrada(p.contaExternaId);
      }
      await this.associar({
        conexaoId,
        contaExternaId: p.contaExternaId,
        contaId: p.contaId,
        cartaoId: p.cartaoId,
      });
    }

    await this.materializar_recursos_sem_destino({
      conexaoId,
      workspaceId: entrada.workspaceId,
      usuarioId: entrada.usuarioId,
      perfil,
      encontradas,
      instituicao,
      soNovosSemOrfaoDoMesmoTipo: true,
    });

    await this.religar_recursos_da_conexao(conexaoId);
    await this.aplicar_saldos_institucionais(conexaoId, encontradas);
    return this.detalhar(conexaoId);
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
    await this.gravar_conexao_na_identidade(entrada);

    return this.detalhar(entrada.conexaoId);
  }

  /**
   * “Atualizar agora”:
   * 1) confirma que o item ainda existe (GET /items, como no conectar);
   * 2) refresca saldo/limite com o snapshot atual da instituição;
   * 3) pede sync pontual — best-effort: a Pluggy recusa com frequência
   *    (já atualizando / limite de 1h / item Meu Pluggy que só synca no app).
   * Extrato novo: importação GET no request da API (e webhook, quando chegar).
   */
  async solicitar_atualizacao(conexaoId: string): Promise<ConexaoComContas> {
    const conexao = await this.exigir_conexao(conexaoId);
    if (conexao.status === "removida") {
      throw new ErroAssociacaoInvalida("Esta conexão foi removida e não pode ser atualizada.");
    }

    if (!(await this.verificar_item_salvo(conexaoId))) {
      return this.detalhar(conexaoId);
    }

    try {
      const encontradas = await this.provedor.listar_contas_externas(conexao.idExterno);
      await this.aplicar_saldos_institucionais(conexaoId, encontradas);

      try {
        await this.provedor.solicitar_atualizacao(conexao.idExterno);
        await this.repositorio.atualizarEstadoConexao(conexaoId, {
          status: "sincronizando",
          motivoAtencao: null,
        });
      } catch (erro) {
        if (erro instanceof ErroConexaoExternaInexistente) throw erro;
        if (!(erro instanceof ErroProvedorIndisponivel)) throw erro;
        /**
         * Sync recusado não é falha da ação: o snapshot de saldo/limite já foi
         * aplicado. Extrato continua o que já tínhamos até o próximo sync aceito.
         */
      }
    } catch (erro) {
      if (await this.marcar_removida_se_inexistente(conexaoId, erro)) {
        return this.detalhar(conexaoId);
      }
      throw erro;
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
   * Fallback Meu Pluggy: o item antigo sumiu do provedor, o usuário informa
   * o novo itemId gerado pelo Meu Pluggy. Atualiza a conexão preservando
   * associações e histórico local — inclusive se o status já for `removida`.
   */
  async atualizar_item_id(conexaoId: string, novoItemId: string): Promise<ConexaoComContas> {
    await this.exigir_conexao(conexaoId);

    const { encontradas } = await this.aplicar_novo_item(conexaoId, novoItemId);
    await this.rematch_contas_externas(
      conexaoId,
      new Set(encontradas.map((c) => c.idExterno)),
    );
    await this.religar_recursos_da_conexao(conexaoId);
    await this.aplicar_saldos_institucionais(conexaoId, encontradas);
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
      }
    }
  }

  private async religar_recursos_da_conexao(conexaoId: string): Promise<void> {
    const contas = await this.repositorio.listarContasExternas(conexaoId);
    for (const conta of contas) {
      if (!conta.contaId && !conta.cartaoId) continue;
      await this.motor.definir_sincronizacao(
        { contaId: conta.contaId ?? undefined, cartaoId: conta.cartaoId ?? undefined },
        true,
      );
      await this.gravar_conexao_na_identidade({
        conexaoId,
        contaId: conta.contaId ?? undefined,
        cartaoId: conta.cartaoId ?? undefined,
      });
    }
  }

  /**
   * Liga recursos externos sem destino a contas/cartões locais já existentes
   * (órfãos com Fato OF ou sync), em vez de materializar duplicata.
   */
  private async adotar_locais_orfos(entrada: {
    conexaoId: string;
    workspaceId: string;
    encontradas: ContaExterna[];
    alvoContaId?: string;
    alvoCartaoId?: string;
  }): Promise<void> {
    const registradas = await this.repositorio.listarContasExternas(entrada.conexaoId);
    const idsNoProvedor = new Set(entrada.encontradas.map((c) => c.idExterno));
    const associados = new Set(
      registradas
        .filter((r) => idsNoProvedor.has(r.contaExternaId) && (r.contaId || r.cartaoId))
        .map((r) => r.contaExternaId),
    );
    const pendentes = () =>
      registradas.filter(
        (r) =>
          idsNoProvedor.has(r.contaExternaId) &&
          !r.contaId &&
          !r.cartaoId &&
          !associados.has(r.contaExternaId),
      );
    if (pendentes().length === 0) return;

    const adotaveis = await this.motor.listar_destinos_adotaveis(entrada.workspaceId);
    const contasLivres: typeof adotaveis.contas = [];
    for (const conta of adotaveis.contas) {
      const dono = await this.repositorio.encontrarConexaoIdPorDestino({ contaId: conta.id });
      if (dono && dono !== entrada.conexaoId) continue;
      contasLivres.push(conta);
    }
    const cartoesLivres: typeof adotaveis.cartoes = [];
    for (const cartao of adotaveis.cartoes) {
      const dono = await this.repositorio.encontrarConexaoIdPorDestino({ cartaoId: cartao.id });
      if (dono && dono !== entrada.conexaoId) continue;
      cartoesLivres.push(cartao);
    }

    const usadosConta = new Set(
      registradas.map((r) => r.contaId).filter((id): id is string => Boolean(id)),
    );
    const usadosCartao = new Set(
      registradas.map((r) => r.cartaoId).filter((id): id is string => Boolean(id)),
    );

    const ligar = async (
      recurso: ContaExternaRegistrada,
      destino: { contaId?: string; cartaoId?: string },
    ) => {
      await this.associar({
        conexaoId: entrada.conexaoId,
        contaExternaId: recurso.contaExternaId,
        contaId: destino.contaId,
        cartaoId: destino.cartaoId,
      });
      associados.add(recurso.contaExternaId);
      if (destino.contaId) usadosConta.add(destino.contaId);
      if (destino.cartaoId) usadosCartao.add(destino.cartaoId);
    };

    if (entrada.alvoCartaoId) {
      const alvo = cartoesLivres.find((c) => c.id === entrada.alvoCartaoId);
      if (alvo && !usadosCartao.has(alvo.id)) {
        const cards = pendentes().filter((r) => recurso_externo_eh_cartao(r.tipo));
        const porNome = cards.filter(
          (r) => nome_normalizado(r.nome) === nome_normalizado(alvo.nome),
        );
        const escolhido =
          porNome.length === 1 ? porNome[0] : cards.length === 1 ? cards[0] : undefined;
        if (escolhido) await ligar(escolhido, { cartaoId: alvo.id });
      }
    }

    if (entrada.alvoContaId) {
      const alvo = contasLivres.find((c) => c.id === entrada.alvoContaId);
      if (alvo && !usadosConta.has(alvo.id)) {
        const contas = pendentes().filter((r) => !recurso_externo_eh_cartao(r.tipo));
        const porNome = contas.filter(
          (r) => nome_normalizado(r.nome) === nome_normalizado(alvo.nome),
        );
        const escolhido =
          porNome.length === 1 ? porNome[0] : contas.length === 1 ? contas[0] : undefined;
        if (escolhido) await ligar(escolhido, { contaId: alvo.id });
      }
    }

    for (const recurso of [...pendentes()]) {
      const ehCartao = recurso_externo_eh_cartao(recurso.tipo);
      const pool = ehCartao
        ? cartoesLivres.filter((c) => !usadosCartao.has(c.id))
        : contasLivres.filter((c) => !usadosConta.has(c.id));
      const nome = nome_normalizado(recurso.nome);
      const candidatos = pool.filter((local) => nome_normalizado(local.nome) === nome);
      if (candidatos.length !== 1) continue;
      const local = candidatos[0]!;
      if (ehCartao) await ligar(recurso, { cartaoId: local.id });
      else await ligar(recurso, { contaId: local.id });
    }

    for (const recurso of [...pendentes()]) {
      const ehCartao = recurso_externo_eh_cartao(recurso.tipo);
      const pool = ehCartao
        ? cartoesLivres.filter((c) => !usadosCartao.has(c.id))
        : contasLivres.filter((c) => !usadosConta.has(c.id));
      const mesmoTipo = pendentes().filter(
        (r) => recurso_externo_eh_cartao(r.tipo) === ehCartao,
      );
      if (pool.length !== 1 || mesmoTipo.length !== 1) continue;
      const local = pool[0]!;
      if (ehCartao) await ligar(recurso, { cartaoId: local.id });
      else await ligar(recurso, { contaId: local.id });
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
    /**
     * Na reconexão, não cria conta/cartão local se ainda houver recurso órfão
     * do mesmo tipo nesta conexão — isso é ambiguidade, não recurso novo.
     */
    soNovosSemOrfaoDoMesmoTipo?: boolean;
  }): Promise<void> {
    const registradas = await this.repositorio.listarContasExternas(entrada.conexaoId);
    const porExterno = new Map(entrada.encontradas.map((item) => [item.idExterno, item] as const));
    let perfilHerdado =
      (await this.perfil_de_irmaos_na_conexao(registradas)) ?? entrada.perfil;

    const idsNoProvedor = new Set(entrada.encontradas.map((item) => item.idExterno));

    for (const recurso of registradas) {
      if (recurso.contaId || recurso.cartaoId) continue;
      if (!idsNoProvedor.has(recurso.contaExternaId)) continue;

      if (entrada.soNovosSemOrfaoDoMesmoTipo) {
        const tipoCartao = recurso_externo_eh_cartao(recurso.tipo);
        const destinosNoProvedor = new Set<string>();
        for (const outra of registradas) {
          if (!idsNoProvedor.has(outra.contaExternaId)) continue;
          if (outra.contaId) destinosNoProvedor.add(`conta:${outra.contaId}`);
          if (outra.cartaoId) destinosNoProvedor.add(`cartao:${outra.cartaoId}`);
        }
        const orfaoNaoRematchado = registradas.some((outra) => {
          if (idsNoProvedor.has(outra.contaExternaId)) return false;
          if (!outra.contaId && !outra.cartaoId) return false;
          if (recurso_externo_eh_cartao(outra.tipo) !== tipoCartao) return false;
          if (outra.contaId && destinosNoProvedor.has(`conta:${outra.contaId}`)) return false;
          if (outra.cartaoId && destinosNoProvedor.has(`cartao:${outra.cartaoId}`)) return false;
          return true;
        });
        if (orfaoNaoRematchado) continue;
      }

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
          conexaoId: entrada.conexaoId,
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
        conexaoId: entrada.conexaoId,
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

  /**
   * Atualiza o itemId da conexão existente (sem criar outra linha) e relista
   * as contas externas do provedor. Permite conexão com status removida —
   * reconectar religa o mesmo registro.
   */
  private async aplicar_novo_item(
    conexaoId: string,
    novoItemId: string,
  ): Promise<{ encontradas: ContaExterna[]; instituicao: string | null }> {
    const conexao = await this.exigir_conexao(conexaoId);
    const estado = await this.provedor.obter_estado(novoItemId);

    if (conexao.idExterno !== novoItemId) {
      const ocupante = await this.repositorio.obterConexao(this.provedor.id, novoItemId);
      if (ocupante && ocupante.id !== conexaoId) {
        throw new ErroAssociacaoInvalida("Este item já está ligado a outra conexão.");
      }
      await this.repositorio.atualizarItemId(conexaoId, novoItemId);
    }

    await this.repositorio.atualizarEstadoConexao(conexaoId, this.traduzir_estado(estado));

    const encontradas = await this.provedor.listar_contas_externas(novoItemId);
    await this.repositorio.sincronizarContasExternas(
      conexaoId,
      encontradas.map((conta: ContaExterna) => ({
        contaExternaId: conta.idExterno,
        nome: conta.nome,
        tipo: conta.tipo,
      })),
    );

    return { encontradas, instituicao: estado.instituicao ?? null };
  }

  /**
   * Copia associação de linhas antigas desta conexão para account ids novos:
   * 1) mesmo id externo já associado → mantém;
   * 2) tipo + nome normalizado, candidato único;
   * 3) tipo único (um órfão e um novo do mesmo tipo).
   */
  private async rematch_contas_externas(
    conexaoId: string,
    idsNoProvedor: Set<string>,
  ): Promise<void> {
    const registradas = await this.repositorio.listarContasExternas(conexaoId);
    const destinosJaNoProvedor = new Set<string>();
    for (const recurso of registradas) {
      if (!idsNoProvedor.has(recurso.contaExternaId)) continue;
      if (recurso.contaId) destinosJaNoProvedor.add(`conta:${recurso.contaId}`);
      if (recurso.cartaoId) destinosJaNoProvedor.add(`cartao:${recurso.cartaoId}`);
    }

    const orfas = registradas.filter(
      (recurso) =>
        !idsNoProvedor.has(recurso.contaExternaId) && (recurso.contaId || recurso.cartaoId),
    );
    const novas = registradas.filter(
      (recurso) =>
        idsNoProvedor.has(recurso.contaExternaId) && !recurso.contaId && !recurso.cartaoId,
    );
    const orfasUsadas = new Set<string>();

    const copiar = async (destino: ContaExternaRegistrada, origem: ContaExternaRegistrada) => {
      await this.repositorio.definirAssociacao(conexaoId, destino.contaExternaId, {
        contaId: origem.contaId,
        cartaoId: origem.cartaoId,
      });
      orfasUsadas.add(origem.contaExternaId);
      if (origem.contaId) destinosJaNoProvedor.add(`conta:${origem.contaId}`);
      if (origem.cartaoId) destinosJaNoProvedor.add(`cartao:${origem.cartaoId}`);
    };

    const orfa_disponivel = (origem: ContaExternaRegistrada) => {
      if (orfasUsadas.has(origem.contaExternaId)) return false;
      if (origem.contaId && destinosJaNoProvedor.has(`conta:${origem.contaId}`)) return false;
      if (origem.cartaoId && destinosJaNoProvedor.has(`cartao:${origem.cartaoId}`)) return false;
      return true;
    };

    for (const nova of novas) {
      const tipoCartao = recurso_externo_eh_cartao(nova.tipo);
      const nome = nome_normalizado(nova.nome);
      const candidatos = orfas.filter(
        (origem) =>
          orfa_disponivel(origem) &&
          recurso_externo_eh_cartao(origem.tipo) === tipoCartao &&
          nome_normalizado(origem.nome) === nome,
      );
      if (candidatos.length === 1) await copiar(nova, candidatos[0]!);
    }

    const registradasDepois = await this.repositorio.listarContasExternas(conexaoId);
    const novasRestantes = registradasDepois.filter(
      (recurso) =>
        idsNoProvedor.has(recurso.contaExternaId) && !recurso.contaId && !recurso.cartaoId,
    );

    for (const nova of novasRestantes) {
      const tipoCartao = recurso_externo_eh_cartao(nova.tipo);
      const candidatos = orfas.filter(
        (origem) =>
          orfa_disponivel(origem) && recurso_externo_eh_cartao(origem.tipo) === tipoCartao,
      );
      if (candidatos.length === 1) await copiar(nova, candidatos[0]!);
    }
  }

  private async gravar_conexao_na_identidade(entrada: {
    conexaoId: string;
    contaId?: string;
    cartaoId?: string;
  }): Promise<void> {
    if (!entrada.contaId && !entrada.cartaoId) return;
    await this.motor.definir_conexao_identidade(
      { contaId: entrada.contaId, cartaoId: entrada.cartaoId },
      entrada.conexaoId,
    );
  }

  private async com_vinculos(conexao: ConexaoDetalhada): Promise<ConexaoListada> {
    const contas = await this.repositorio.listarContasExternas(conexao.id);
    return this.com_vinculos_de(conexao, contas);
  }

  private com_vinculos_de(
    conexao: ConexaoDetalhada,
    contas: ContaExternaRegistrada[],
  ): ConexaoListada {
    const contasVinculadas = contas.filter((c) => c.contaId);
    const cartoesVinculados = contas.filter((c) => c.cartaoId);
    return {
      ...conexao,
      contasVinculadas: {
        quantidade: contasVinculadas.length,
        nomes: contasVinculadas.map((c) => c.nome),
      },
      cartoesVinculados: {
        quantidade: cartoesVinculados.length,
        nomes: cartoesVinculados.map((c) => c.nome),
      },
    };
  }

  private traduzir_estado(estado: EstadoConexao) {
    return {
      status: estado.status,
      motivoAtencao: estado.motivoAtencao ?? null,
      instituicao: estado.instituicao ?? null,
      consentimentoExpiraEm: estado.consentimentoExpiraEm ?? null,
    };
  }

  /**
   * GET 404 no item: o webhook `item/deleted` pode não ter chegado. Mesmo efeito.
   */
  private async marcar_removida_se_inexistente(
    conexaoId: string,
    erro: unknown,
  ): Promise<boolean> {
    if (!(erro instanceof ErroConexaoExternaInexistente)) return false;
    await this.repositorio.atualizarEstadoConexao(conexaoId, {
      status: "removida",
      motivoAtencao: null,
    });
    return true;
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

function nome_normalizado(nome: string): string {
  return nome
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}
