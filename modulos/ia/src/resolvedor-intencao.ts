import { CATEGORIA_NAO_CLASSIFICADO, type Cartao, type Conta, type Movimento } from "@lancai/banco";
import type {
  EntradaAtualizarCartao,
  EntradaAtualizarConta,
  EntradaCorrigirMovimento,
  EntradaCriarMovimento,
  FiltrosVisaoResolvidos,
  IntencaoConsultarVisao,
  IntencaoCorrigirCartao,
  IntencaoCorrigirConta,
  IntencaoCorrigirMovimento,
  IntencaoCriarCartao,
  IntencaoCriarConta,
  IntencaoRegistrarMovimento,
  TipoFonte,
} from "@lancai/tipos";
import { fato_protegido } from "@lancai/tipos";
import {
  ErroDadosPlasticosInvalidos,
  preparar_persistencia_plasticos,
} from "./cifragem-cartao";
import {
  ErroDadosIncompletos,
  ErroEntidadeJaExiste,
  ErroReferenciaAmbiguo,
  ErroReferenciaNaoEncontrada,
} from "./erros";
import {
  montar_lista_lancamentos_semelhantes,
  type ItemLancamentoSemelhante,
} from "./montar-lista-semelhantes";
import { rotulo_descricao_busca } from "./normalizar-descricao";
import type { RepositorioContexto } from "./repositorio-contexto";

function nome_busca_lancamento(
  descricao?: string | null,
  dataMovimento?: string | null,
): string {
  const rotulo = rotulo_descricao_busca(descricao);
  if (rotulo !== "não especificado") return rotulo;
  return dataMovimento ?? "não especificado";
}

/** Só Conhecimento — permite “esse” sem nome cair no lançamento mais recente. */
function eh_so_enriquecimento(
  campos: IntencaoCorrigirMovimento["campos_alterados"],
): boolean {
  const chavesFato = [
    campos.valor,
    campos.data_movimento,
    campos.conta_nome,
    campos.cartao_nome,
    campos.parcelas,
    campos.status,
    campos.forma_pagamento,
  ];
  if (chavesFato.some((v) => v != null && v !== undefined)) return false;
  return (
    campos.ignorado_em_relatorio != null ||
    campos.tags != null ||
    campos.observacoes !== undefined ||
    campos.categoria_nome != null ||
    campos.pessoa_nome != null ||
    campos.perfil != null ||
    campos.descricao != null
  );
}

export interface ContextoResolucao {
  usuarioId: string;
  criadoPor: string;
  workspaceId: string;
  /** Canal que originou o pedido. Define a `fonte` do lançamento criado. */
  fonte: TipoFonte;
}

/**
 * Traduz a saída "amigável" (nomes em texto livre) do `InterpretadorIntencoes`
 * para os DTOs de IDs que o `MotorFinanceiro` espera. Por decisão de produto:
 * - categoria e pessoa são criadas automaticamente quando não existem ainda
 *   (filosofia de "cadastro incremental");
 * - conta e cartão NUNCA são criados automaticamente aqui — exigem dados que
 *   só o usuário pode fornecer (saldo inicial, limite, fechamento etc.), então
 *   geram `ErroReferenciaNaoEncontrada` pedindo confirmação.
 */
export class ResolvedorIntencao {
  constructor(private readonly repositorio: RepositorioContexto) {}

  async resolver_registrar_movimento(
    intencao: IntencaoRegistrarMovimento,
    contexto: ContextoResolucao,
  ): Promise<EntradaCriarMovimento> {
    const { usuarioId, criadoPor } = contexto;

    if (intencao.valor == null) throw new ErroDadosIncompletos("REGISTRAR_MOVIMENTO", "o valor");
    if (!intencao.perfil) throw new ErroDadosIncompletos("REGISTRAR_MOVIMENTO", "se é pessoal ou da empresa");
    if (!intencao.data_movimento) throw new ErroDadosIncompletos("REGISTRAR_MOVIMENTO", "a data");
    if (!intencao.conta_nome && !intencao.cartao_nome) {
      throw new ErroDadosIncompletos("REGISTRAR_MOVIMENTO", "a conta ou o cartão usado");
    }

    const contaId = await this.resolver_conta_opcional(usuarioId, intencao.conta_nome);
    const cartaoId = await this.resolver_cartao_opcional(usuarioId, intencao.cartao_nome);
    const contaDestinoId = await this.resolver_conta_opcional(usuarioId, intencao.conta_destino_nome, "conta de destino");
    const categoriaId = await this.resolver_ou_criar_categoria(
      usuarioId,
      intencao.categoria_nome,
      intencao.tipo_movimento,
    );
    const pessoaId = await this.resolver_ou_criar_pessoa(usuarioId, intencao.pessoa_nome);

    return {
      workspaceId: contexto.workspaceId,
      fonte: contexto.fonte,
      descricao: intencao.descricao,
      valor: intencao.valor,
      tipo: intencao.tipo_movimento,
      status: "realizado",
      perfil: intencao.perfil,
      formaPagamento:
        intencao.forma_pagamento ??
        (intencao.cartao_nome ? "credito" : intencao.conta_nome ? "pix" : null),
      dataMovimento: intencao.data_movimento,
      contaId,
      cartaoId,
      contaDestinoId,
      categoriaId,
      pessoaId,
      usuarioId,
      criadoPor,
      parcelamento: intencao.parcelas ? { quantidadeParcelas: intencao.parcelas } : undefined,
    };
  }

  async resolver_corrigir_movimento(
    intencao: IntencaoCorrigirMovimento,
    contexto: ContextoResolucao,
  ): Promise<EntradaCorrigirMovimento> {
    const { usuarioId, criadoPor } = contexto;

    const candidatos = await this.repositorio.listarMovimentosParaCorrecao(usuarioId, {
      descricao: intencao.referencia.descricao ?? undefined,
      dataMovimento: intencao.referencia.data_movimento ?? undefined,
      codigo: intencao.referencia.codigo ?? undefined,
    });
    if (candidatos.length === 0) {
      throw new ErroReferenciaNaoEncontrada(
        "lançamento",
        intencao.referencia.codigo
          ? `#${intencao.referencia.codigo.replace(/^#/, "")}`
          : nome_busca_lancamento(intencao.referencia.descricao, intencao.referencia.data_movimento),
      );
    }

    const camposAlterados = intencao.campos_alterados;
    const soEnriquecimento = eh_so_enriquecimento(camposAlterados);

    let movimentoAlvo = candidatos[0]!;
    const indice = intencao.referencia.indice ?? null;
    if (indice != null) {
      const escolhido = candidatos[indice - 1];
      if (!escolhido) {
        throw new ErroReferenciaNaoEncontrada("lançamento", `nº ${indice}`);
      }
      movimentoAlvo = escolhido;
    } else if (
      candidatos.length > 1 &&
      !intencao.referencia.codigo &&
      // "não considera esse nos relatórios": sem nome, pega o mais recente.
      !(soEnriquecimento && !intencao.referencia.descricao)
    ) {
      const rotulo = nome_busca_lancamento(
        intencao.referencia.descricao,
        intencao.referencia.data_movimento,
      );
      const itens = await this.itens_semelhantes_com_origem(usuarioId, candidatos);
      throw new ErroReferenciaAmbiguo(montar_lista_lancamentos_semelhantes(rotulo, itens, "corrigir"));
    }

    const campos: EntradaCorrigirMovimento["campos"] = {};

    if (camposAlterados.valor != null) campos.valor = camposAlterados.valor;
    if (camposAlterados.descricao) campos.descricao = camposAlterados.descricao;
    if (camposAlterados.data_movimento) campos.dataMovimento = camposAlterados.data_movimento;
    if (camposAlterados.perfil) campos.perfil = camposAlterados.perfil;
    if (camposAlterados.parcelas != null) campos.parcelas = camposAlterados.parcelas;
    if (camposAlterados.status) campos.status = camposAlterados.status;
    if (camposAlterados.forma_pagamento !== undefined) {
      campos.formaPagamento = camposAlterados.forma_pagamento;
    }
    if (camposAlterados.ignorado_em_relatorio != null) {
      campos.ignoradoEmRelatorio = camposAlterados.ignorado_em_relatorio;
    }
    if (camposAlterados.tags) campos.tags = camposAlterados.tags;
    if (camposAlterados.observacoes !== undefined) {
      campos.observacoes = camposAlterados.observacoes;
    }

    if (camposAlterados.categoria_nome) {
      const categoria = await this.buscar_ou_criar_categoria(usuarioId, camposAlterados.categoria_nome, "ambos");
      campos.categoriaId = categoria.id;
    }
    if (camposAlterados.conta_nome) {
      campos.contaId = await this.resolver_conta_obrigatoria(usuarioId, camposAlterados.conta_nome);
    }
    if (camposAlterados.cartao_nome) {
      campos.cartaoId = await this.resolver_cartao_obrigatorio(usuarioId, camposAlterados.cartao_nome);
    }
    if (camposAlterados.pessoa_nome) {
      campos.pessoaId = await this.resolver_ou_criar_pessoa(usuarioId, camposAlterados.pessoa_nome);
    }

    return {
      movimentoId: movimentoAlvo.id,
      alteradoPor: criadoPor,
      campos,
    };
  }

  /**
   * Traduz os filtros em texto livre de CONSULTAR_VISAO (Fase 5) para IDs.
   * Diferente de REGISTRAR_MOVIMENTO, aqui nenhum filtro é criado automaticamente
   * quando não existe — se o usuário citou um nome que não bate com nada, é sinal
   * de erro de digitação/entendimento, e é melhor avisar do que devolver um
   * resultado vazio e enganoso (ex.: uma categoria "criada na hora" sem nenhum
   * lançamento nunca teria dados pra mostrar).
   */
  async resolver_consultar_visao(
    intencao: IntencaoConsultarVisao,
    contexto: ContextoResolucao,
  ): Promise<FiltrosVisaoResolvidos> {
    const { usuarioId } = contexto;
    const { filtros } = intencao;

    const contaId = filtros.conta_nome
      ? await this.resolver_conta_obrigatoria(usuarioId, filtros.conta_nome, "conta do filtro")
      : undefined;
    const cartaoId = filtros.cartao_nome ? await this.resolver_cartao_obrigatorio(usuarioId, filtros.cartao_nome) : undefined;
    const categoriaId = filtros.categoria_nome
      ? await this.resolver_categoria_obrigatoria(usuarioId, filtros.categoria_nome)
      : undefined;
    const pessoaId = filtros.pessoa_nome ? await this.resolver_pessoa_obrigatoria(usuarioId, filtros.pessoa_nome) : undefined;

    return {
      usuarioId,
      perfil: filtros.perfil ?? undefined,
      contaId,
      cartaoId,
      categoriaId,
      pessoaId,
      descricao: filtros.descricao?.trim() || undefined,
      periodo: filtros.periodo ?? undefined,
      tipos: filtros.tipos?.length ? [...filtros.tipos] : undefined,
    };
  }

  /**
   * Cria uma conta a partir do onboarding conversacional. No fluxo normal, a
   * IA só devolve CRIAR_CONTA "completa" (nome, saldo_inicial, perfil) depois
   * de já ter usado SOLICITAR_INFORMACAO para preencher o que faltava — os
   * campos ausentes aqui são tratados como erro (rede de segurança, não o
   * caminho esperado).
   */
  async resolver_criar_conta(intencao: IntencaoCriarConta, contexto: ContextoResolucao): Promise<Conta> {
    if (!intencao.nome) throw new ErroDadosIncompletos("CRIAR_CONTA", "nome da conta");
    if (intencao.saldo_inicial == null) throw new ErroDadosIncompletos("CRIAR_CONTA", "saldo atual da conta");
    if (!intencao.perfil) throw new ErroDadosIncompletos("CRIAR_CONTA", "perfil (pessoal ou empresa)");

    const existente = await this.repositorio.buscarContaPorNome(contexto.usuarioId, intencao.nome);
    if (existente) throw new ErroEntidadeJaExiste("conta", existente.nome);

    return this.repositorio.criarConta({
      nome: intencao.nome,
      saldoInicial: intencao.saldo_inicial,
      perfil: intencao.perfil,
      usuarioId: contexto.usuarioId,
    });
  }

  /** Mesma lógica de `resolver_criar_conta`, mas para cartão — `conta_nome` é opcional no crédito. */
  async resolver_criar_cartao(intencao: IntencaoCriarCartao, contexto: ContextoResolucao): Promise<Cartao> {
    if (!intencao.nome) throw new ErroDadosIncompletos("CRIAR_CARTAO", "nome do cartão");
    if (!intencao.perfil) throw new ErroDadosIncompletos("CRIAR_CARTAO", "perfil (pessoal ou empresa)");

    const modalidade =
      intencao.modalidade ?? (intencao.conta_nome ? "multiplo" : "credito");

    if (modalidade === "debito" && !intencao.conta_nome) {
      throw new ErroDadosIncompletos("CRIAR_CARTAO", "a conta vinculada (obrigatória para cartão de débito)");
    }
    if (modalidade !== "debito") {
      if (intencao.limite == null) throw new ErroDadosIncompletos("CRIAR_CARTAO", "limite do cartão");
      if (intencao.fechamento == null) throw new ErroDadosIncompletos("CRIAR_CARTAO", "dia de fechamento da fatura");
      if (intencao.vencimento == null) throw new ErroDadosIncompletos("CRIAR_CARTAO", "dia de vencimento da fatura");
    }

    const existente = await this.repositorio.buscarCartaoPorNome(contexto.usuarioId, intencao.nome);
    if (existente) throw new ErroEntidadeJaExiste("cartão", existente.nome);

    const contaId = intencao.conta_nome
      ? await this.resolver_conta_obrigatoria(contexto.usuarioId, intencao.conta_nome, "conta vinculada ao cartão")
      : undefined;

    const plasticos = this.montar_plasticos_opcionais(intencao.numero, intencao.validade, intencao.cvv);

    return this.repositorio.criarCartao({
      nome: intencao.nome,
      limite: intencao.limite ?? 0,
      fechamento: intencao.fechamento ?? 1,
      vencimento: intencao.vencimento ?? 1,
      perfil: intencao.perfil,
      modalidade,
      contaId,
      usuarioId: contexto.usuarioId,
      ...plasticos,
    });
  }

  /**
   * Corrige uma conta JÁ EXISTENTE (ex.: "muda o saldo da conta Mercado Pago pra 5000").
   * Ponto-chave do fix para o bug de duplicação: pedidos de alteração de saldo/nome/perfil
   * de uma conta existente devem passar por aqui, nunca por `resolver_criar_conta`.
   */
  async resolver_corrigir_conta(intencao: IntencaoCorrigirConta, contexto: ContextoResolucao): Promise<Conta> {
    const contaId = await this.resolver_conta_obrigatoria(contexto.usuarioId, intencao.conta_nome);
    const alterados = intencao.campos_alterados;

    const dados: EntradaAtualizarConta = {};
    if (alterados.nome != null) dados.nome = alterados.nome;
    if (alterados.saldo_atual != null) dados.saldoAtual = alterados.saldo_atual;
    if (alterados.perfil != null) dados.perfil = alterados.perfil;
    if (alterados.ativo != null) dados.ativo = alterados.ativo;

    if (Object.keys(dados).length === 0) {
      throw new ErroDadosIncompletos("CORRIGIR_CONTA", "o que deseja alterar (nome, saldo, perfil ou exclusão)");
    }

    return this.repositorio.atualizarConta(contexto.usuarioId, contaId, dados);
  }

  /** Mesma lógica de `resolver_corrigir_conta`, mas para cartão. */
  async resolver_corrigir_cartao(intencao: IntencaoCorrigirCartao, contexto: ContextoResolucao): Promise<Cartao> {
    const cartaoId = await this.resolver_cartao_obrigatorio(contexto.usuarioId, intencao.cartao_nome);
    const alterados = intencao.campos_alterados;

    const dados: EntradaAtualizarCartao = {};
    if (alterados.nome != null) dados.nome = alterados.nome;
    if (alterados.limite != null) dados.limite = alterados.limite;
    if (alterados.fechamento != null) dados.fechamento = alterados.fechamento;
    if (alterados.vencimento != null) dados.vencimento = alterados.vencimento;
    if (alterados.perfil != null) dados.perfil = alterados.perfil;
    if (alterados.modalidade != null) dados.modalidade = alterados.modalidade;
    if (alterados.ativo != null) dados.ativo = alterados.ativo;
    if (alterados.conta_nome != null) {
      dados.contaId = await this.resolver_conta_obrigatoria(
        contexto.usuarioId,
        alterados.conta_nome,
        "conta vinculada ao cartão",
      );
      // Vincular conta a um cartão de crédito puro o torna múltiplo.
      if (dados.modalidade == null) dados.modalidade = "multiplo";
    }

    const temAlgumPlastico =
      alterados.numero != null || alterados.validade != null || alterados.cvv != null;
    if (temAlgumPlastico) {
      const numero = alterados.numero != null ? String(alterados.numero).trim() : "";
      const validade = alterados.validade != null ? String(alterados.validade).trim() : "";
      const cvv = alterados.cvv != null ? String(alterados.cvv).trim() : "";
      if (!numero || !validade || !cvv) {
        throw new ErroDadosIncompletos(
          "CORRIGIR_CARTAO",
          "número, validade (MM/AA) e CVV juntos para atualizar os dados do plástico",
        );
      }
      Object.assign(dados, this.montar_plasticos_opcionais(numero, validade, cvv));
    }

    if (Object.keys(dados).length === 0) {
      throw new ErroDadosIncompletos(
        "CORRIGIR_CARTAO",
        "o que deseja alterar (nome, limite, fechamento, vencimento, perfil, conta, dados do plástico ou exclusão)",
      );
    }

    return this.repositorio.atualizarCartao(contexto.usuarioId, cartaoId, dados);
  }

  /**
   * Prévia da exclusão de conta: resolve o nome e conta quantos lançamentos
   * ainda estão vinculados (não cancelados). Usado para montar a pergunta de
   * confirmação sem alterar nada no banco.
   */
  async preparar_confirmacao_exclusao_conta(
    usuarioId: string,
    contaNome: string,
  ): Promise<{ nome: string; totalLancamentos: number }> {
    const conta = await this.repositorio.buscarContaPorNome(usuarioId, contaNome);
    if (!conta) throw new ErroReferenciaNaoEncontrada("conta", contaNome);
    const totalLancamentos = await this.repositorio.contarMovimentosVinculadosConta(conta.id);
    return { nome: conta.nome, totalLancamentos };
  }

  /** Mesma lógica de `preparar_confirmacao_exclusao_conta`, para cartão. */
  async preparar_confirmacao_exclusao_cartao(
    usuarioId: string,
    cartaoNome: string,
  ): Promise<{ nome: string; totalLancamentos: number }> {
    const cartao = await this.repositorio.buscarCartaoPorNome(usuarioId, cartaoNome);
    if (!cartao) throw new ErroReferenciaNaoEncontrada("cartão", cartaoNome);
    const totalLancamentos = await this.repositorio.contarMovimentosVinculadosCartao(cartao.id);
    return { nome: cartao.nome, totalLancamentos };
  }

  /**
   * Prévia do cancelamento: lista todos os lançamentos que batem com a
   * referência (descrição normalizada + data opcional), sem side-effects.
   */
  async preparar_confirmacao_exclusao_movimento(
    usuarioId: string,
    referencia: {
      descricao?: string | null;
      data_movimento?: string | null;
      codigo?: string | null;
    },
  ): Promise<{
    descricao: string;
    dataMovimento: string | null;
    quantidade: number;
    valorTotal: number;
    movimentoIds: string[];
    codigo: string | null;
    itens: ItemLancamentoSemelhante[];
    /** Descrição dos itens que a exclusão não pode tocar. Vazio no caso comum. */
    protegidos: string[];
  }> {
    const movimentos = await this.repositorio.listarMovimentosParaCorrecao(usuarioId, {
      descricao: referencia.descricao ?? undefined,
      dataMovimento: referencia.data_movimento ?? undefined,
      codigo: referencia.codigo ?? undefined,
    });
    if (movimentos.length === 0) {
      throw new ErroReferenciaNaoEncontrada(
        "lançamento",
        referencia.codigo
          ? `#${referencia.codigo.replace(/^#/, "")}`
          : nome_busca_lancamento(referencia.descricao, referencia.data_movimento),
      );
    }

    const datas = new Set(movimentos.map((item) => item.dataMovimento));
    const valorTotal = movimentos.reduce((soma, item) => soma + Number(item.valor), 0);
    const rotulo = rotulo_descricao_busca(referencia.descricao);
    const itens = await this.itens_semelhantes_com_origem(usuarioId, movimentos);

    return {
      descricao: rotulo !== "não especificado" ? rotulo : movimentos[0]!.descricao,
      dataMovimento: datas.size === 1 ? movimentos[0]!.dataMovimento : null,
      quantidade: movimentos.length,
      valorTotal,
      movimentoIds: movimentos.map((item) => item.id),
      codigo: movimentos.length === 1 ? movimentos[0]!.id : null,
      itens,
      protegidos: itens
        .filter((item) => item.protegido)
        .map((item) => item.origemRotulo ?? item.descricao),
    };
  }

  /** Resolve cancelamento em lote: um DTO por lançamento que bate com a referência. */
  async resolver_cancelar_movimentos(
    intencao: IntencaoCorrigirMovimento,
    contexto: ContextoResolucao,
  ): Promise<{ entradas: EntradaCorrigirMovimento[]; descricao: string }> {
    let movimentos = await this.repositorio.listarMovimentosParaCorrecao(contexto.usuarioId, {
      descricao: intencao.referencia.descricao ?? undefined,
      dataMovimento: intencao.referencia.data_movimento ?? undefined,
      codigo: intencao.referencia.codigo ?? undefined,
    });
    if (movimentos.length === 0) {
      throw new ErroReferenciaNaoEncontrada(
        "lançamento",
        intencao.referencia.codigo
          ? `#${intencao.referencia.codigo.replace(/^#/, "")}`
          : nome_busca_lancamento(intencao.referencia.descricao, intencao.referencia.data_movimento),
      );
    }

    const indice = intencao.referencia.indice ?? null;
    if (indice != null) {
      const escolhido = movimentos[indice - 1];
      if (!escolhido) {
        throw new ErroReferenciaNaoEncontrada("lançamento", `nº ${indice}`);
      }
      movimentos = [escolhido];
    }

    const rotulo = rotulo_descricao_busca(intencao.referencia.descricao);

    return {
      descricao: rotulo !== "não especificado" ? rotulo : movimentos[0]!.descricao,
      entradas: movimentos.map((movimento) => ({
        movimentoId: movimento.id,
        alteradoPor: contexto.criadoPor,
        campos: { status: "cancelado" as const },
      })),
    };
  }

  /**
   * Se já existir lançamento igual (valor + data + descrição + conta/cartão),
   * devolve os dados para a pergunta de confirmação. Sem side-effects.
   */
  async preparar_confirmacao_duplicata_movimento(
    usuarioId: string,
    intencao: IntencaoRegistrarMovimento,
  ): Promise<{
    descricao: string;
    dataMovimento: string;
    valor: number;
    origemRotulo: string;
  } | null> {
    if (intencao.valor == null || !intencao.data_movimento) return null;

    const conta = intencao.conta_nome
      ? await this.repositorio.buscarContaPorNome(usuarioId, intencao.conta_nome)
      : undefined;
    const cartao = intencao.cartao_nome
      ? await this.repositorio.buscarCartaoPorNome(usuarioId, intencao.cartao_nome)
      : undefined;

    const similar = await this.repositorio.buscarMovimentoSimilar(usuarioId, {
      descricao: intencao.descricao,
      valor: intencao.valor,
      dataMovimento: intencao.data_movimento,
      contaId: conta?.id ?? null,
      cartaoId: cartao?.id ?? null,
    });
    if (!similar) return null;

    const origemRotulo = intencao.cartao_nome
      ? `no cartão ${cartao?.nome ?? intencao.cartao_nome}`
      : intencao.conta_nome
        ? `na conta ${conta?.nome ?? intencao.conta_nome}`
        : "";

    return {
      descricao: similar.descricao,
      dataMovimento: similar.dataMovimento,
      valor: Number(similar.valor),
      origemRotulo,
    };
  }

  private montar_plasticos_opcionais(
    numero: string | null | undefined,
    validade: string | null | undefined,
    cvv: string | null | undefined,
  ): { dadosPlasticosCifrados?: string } {
    const temAlgum = numero != null || validade != null || cvv != null;
    if (!temAlgum) return {};
    if (!numero || !validade || !cvv) {
      throw new ErroDadosIncompletos(
        "CRIAR_CARTAO",
        "número, validade (MM/AA) e CVV juntos se for salvar os dados do plástico",
      );
    }
    try {
      const preparado = preparar_persistencia_plasticos({ numero, validade, cvv });
      return { dadosPlasticosCifrados: preparado.dadosPlasticosCifrados };
    } catch (erro) {
      if (erro instanceof ErroDadosPlasticosInvalidos) throw erro;
      throw erro;
    }
  }

  private async itens_semelhantes_com_origem(
    usuarioId: string,
    movimentos: Movimento[],
  ): Promise<ItemLancamentoSemelhante[]> {
    const [contas, cartoes] = await Promise.all([
      this.repositorio.listarContas(usuarioId),
      this.repositorio.listarCartoes(usuarioId),
    ]);
    const contasPorId = new Map(contas.map((c) => [c.id, c]));
    const cartoesPorId = new Map(cartoes.map((c) => [c.id, c]));

    return movimentos.map((item) => {
      let origemRotulo: string | null = null;
      let origem: { sincronizada: boolean } | null = null;
      if (item.cartaoId) {
        const cartao = cartoesPorId.get(item.cartaoId);
        origemRotulo = cartao ? `cartão ${cartao.nome}` : null;
        origem = cartao ?? null;
      } else if (item.contaId) {
        const conta = contasPorId.get(item.contaId);
        origemRotulo = conta?.nome ?? null;
        origem = conta ?? null;
      }
      return {
        id: item.id,
        descricao: item.descricao,
        valor: Number(item.valor),
        dataMovimento: item.dataMovimento,
        dataLancamento: item.dataLancamento,
        tipo: item.tipo,
        origemRotulo,
        protegido: fato_protegido(item, origem),
      };
    });
  }

  private async resolver_conta_opcional(
    usuarioId: string,
    nome: string | null | undefined,
    rotulo = "conta",
  ): Promise<string | undefined> {
    if (!nome) return undefined;
    return this.resolver_conta_obrigatoria(usuarioId, nome, rotulo);
  }

  private async resolver_conta_obrigatoria(usuarioId: string, nome: string, rotulo = "conta"): Promise<string> {
    const conta = await this.repositorio.buscarContaPorNome(usuarioId, nome);
    if (!conta) throw new ErroReferenciaNaoEncontrada(rotulo, nome);
    return conta.id;
  }

  private async resolver_cartao_opcional(usuarioId: string, nome: string | null | undefined): Promise<string | undefined> {
    if (!nome) return undefined;
    return this.resolver_cartao_obrigatorio(usuarioId, nome);
  }

  private async resolver_cartao_obrigatorio(usuarioId: string, nome: string): Promise<string> {
    const cartao = await this.repositorio.buscarCartaoPorNome(usuarioId, nome);
    if (!cartao) throw new ErroReferenciaNaoEncontrada("cartão", nome);
    return cartao.id;
  }

  private async resolver_categoria_obrigatoria(usuarioId: string, nome: string): Promise<string> {
    const categoria = await this.repositorio.buscarCategoriaPorNome(usuarioId, nome);
    if (!categoria) throw new ErroReferenciaNaoEncontrada("categoria", nome);
    return categoria.id;
  }

  private async resolver_pessoa_obrigatoria(usuarioId: string, nome: string): Promise<string> {
    const pessoa = await this.repositorio.buscarPessoaPorNome(usuarioId, nome);
    if (!pessoa) throw new ErroReferenciaNaoEncontrada("pessoa", nome);
    return pessoa.id;
  }

  private async buscar_ou_criar_categoria(usuarioId: string, nome: string, tipoSugerido: "receita" | "despesa" | "ambos") {
    const existente = await this.repositorio.buscarCategoriaPorNome(usuarioId, nome);
    return existente ?? this.repositorio.criarCategoria(usuarioId, nome, tipoSugerido);
  }

  private async resolver_ou_criar_categoria(
    usuarioId: string,
    nome: string | null | undefined,
    tipoMovimento: IntencaoRegistrarMovimento["tipo_movimento"],
  ): Promise<string> {
    const tipoSugerido = tipoMovimento === "receita" ? "receita" : tipoMovimento === "despesa" ? "despesa" : "ambos";
    // Sem categoria na frase → pendente de regra/IA (não “Outros” como se o usuário tivesse escolhido).
    const categoria = await this.buscar_ou_criar_categoria(
      usuarioId,
      nome?.trim() ? nome : CATEGORIA_NAO_CLASSIFICADO,
      tipoSugerido,
    );
    return categoria.id;
  }

  private async resolver_ou_criar_pessoa(usuarioId: string, nome: string | null | undefined): Promise<string | undefined> {
    if (!nome) return undefined;
    const existente = await this.repositorio.buscarPessoaPorNome(usuarioId, nome);
    const pessoa = existente ?? (await this.repositorio.criarPessoa(usuarioId, nome, "cliente"));
    return pessoa.id;
  }

  /** Resolve categoria por nome (cria se não existir) — orçamento / recorrência. */
  async resolver_categoria_nome(
    usuarioId: string,
    nome: string | null | undefined,
    tipoSugerido: "receita" | "despesa" | "ambos" = "despesa",
  ): Promise<{ id: string; nome: string } | null> {
    if (!nome?.trim()) return null;
    const categoria = await this.buscar_ou_criar_categoria(usuarioId, nome.trim(), tipoSugerido);
    return { id: categoria.id, nome: categoria.nome };
  }

  /** Só busca categoria existente (consulta de orçamento). */
  async buscar_categoria_nome(
    usuarioId: string,
    nome: string | null | undefined,
  ): Promise<{ id: string; nome: string } | null> {
    if (!nome?.trim()) return null;
    const categoria = await this.repositorio.buscarCategoriaPorNome(usuarioId, nome.trim());
    return categoria ? { id: categoria.id, nome: categoria.nome } : null;
  }

  async resolver_conta_nome(usuarioId: string, nome: string | null | undefined): Promise<string | undefined> {
    return this.resolver_conta_opcional(usuarioId, nome);
  }

  async resolver_cartao_nome(usuarioId: string, nome: string | null | undefined): Promise<string | undefined> {
    return this.resolver_cartao_opcional(usuarioId, nome);
  }
}
