import type { Cartao, Conta } from "@lancai/banco";
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
} from "@lancai/tipos";
import {
  ErroDadosPlasticosInvalidos,
  preparar_persistencia_plasticos,
} from "./cifragem-cartao";
import { ErroDadosIncompletos, ErroEntidadeJaExiste, ErroReferenciaNaoEncontrada } from "./erros";
import type { RepositorioContexto } from "./repositorio-contexto";

const NOME_CATEGORIA_PADRAO = "Outros";

export interface ContextoResolucao {
  usuarioId: string;
  criadoPor: string;
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
    const categoriaId = await this.resolver_ou_criar_categoria(usuarioId, intencao.categoria_nome, intencao.tipo_movimento);
    const pessoaId = await this.resolver_ou_criar_pessoa(usuarioId, intencao.pessoa_nome);

    return {
      descricao: intencao.descricao,
      valor: intencao.valor,
      tipo: intencao.tipo_movimento,
      status: "realizado",
      perfil: intencao.perfil,
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

    const movimentoAlvo = await this.repositorio.buscarMovimentoParaCorrecao(usuarioId, {
      descricao: intencao.referencia.descricao ?? undefined,
      dataMovimento: intencao.referencia.data_movimento ?? undefined,
    });
    if (!movimentoAlvo) {
      throw new ErroReferenciaNaoEncontrada(
        "lançamento",
        intencao.referencia.descricao ?? intencao.referencia.data_movimento ?? "não especificado",
      );
    }

    const camposAlterados = intencao.campos_alterados;
    const campos: EntradaCorrigirMovimento["campos"] = {};

    if (camposAlterados.valor != null) campos.valor = camposAlterados.valor;
    if (camposAlterados.descricao) campos.descricao = camposAlterados.descricao;
    if (camposAlterados.data_movimento) campos.dataMovimento = camposAlterados.data_movimento;
    if (camposAlterados.perfil) campos.perfil = camposAlterados.perfil;
    if (camposAlterados.parcelas != null) campos.parcelas = camposAlterados.parcelas;
    if (camposAlterados.status) campos.status = camposAlterados.status;

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
      periodo: filtros.periodo ?? undefined,
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

  /** Mesma lógica de `resolver_criar_conta`, mas para cartão — resolve `conta_nome` para `contaId`. */
  async resolver_criar_cartao(intencao: IntencaoCriarCartao, contexto: ContextoResolucao): Promise<Cartao> {
    if (!intencao.nome) throw new ErroDadosIncompletos("CRIAR_CARTAO", "nome do cartão");
    if (intencao.limite == null) throw new ErroDadosIncompletos("CRIAR_CARTAO", "limite do cartão");
    if (intencao.fechamento == null) throw new ErroDadosIncompletos("CRIAR_CARTAO", "dia de fechamento da fatura");
    if (intencao.vencimento == null) throw new ErroDadosIncompletos("CRIAR_CARTAO", "dia de vencimento da fatura");
    if (!intencao.perfil) throw new ErroDadosIncompletos("CRIAR_CARTAO", "perfil (pessoal ou empresa)");
    if (!intencao.conta_nome) throw new ErroDadosIncompletos("CRIAR_CARTAO", "qual conta paga a fatura desse cartão");

    const existente = await this.repositorio.buscarCartaoPorNome(contexto.usuarioId, intencao.nome);
    if (existente) throw new ErroEntidadeJaExiste("cartão", existente.nome);

    const contaId = await this.resolver_conta_obrigatoria(contexto.usuarioId, intencao.conta_nome, "conta vinculada ao cartão");

    const plasticos = this.montar_plasticos_opcionais(intencao.numero, intencao.validade, intencao.cvv);

    return this.repositorio.criarCartao({
      nome: intencao.nome,
      limite: intencao.limite,
      fechamento: intencao.fechamento,
      vencimento: intencao.vencimento,
      perfil: intencao.perfil,
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
    if (alterados.ativo != null) dados.ativo = alterados.ativo;
    if (alterados.conta_nome != null) {
      dados.contaId = await this.resolver_conta_obrigatoria(
        contexto.usuarioId,
        alterados.conta_nome,
        "conta vinculada ao cartão",
      );
    }

    const temAlgumPlastico =
      alterados.numero != null || alterados.validade != null || alterados.cvv != null;
    if (temAlgumPlastico) {
      if (!alterados.numero || !alterados.validade || !alterados.cvv) {
        throw new ErroDadosIncompletos(
          "CORRIGIR_CARTAO",
          "número, validade (MM/AA) e CVV juntos para atualizar os dados do plástico",
        );
      }
      Object.assign(dados, this.montar_plasticos_opcionais(alterados.numero, alterados.validade, alterados.cvv));
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
   * Prévia do cancelamento de lançamento: localiza o alvo pela referência sem
   * alterar nada — usada para montar a pergunta de confirmação.
   */
  async preparar_confirmacao_exclusao_movimento(
    usuarioId: string,
    referencia: { descricao?: string | null; data_movimento?: string | null },
  ): Promise<{ descricao: string; dataMovimento: string; valor: number }> {
    const movimento = await this.repositorio.buscarMovimentoParaCorrecao(usuarioId, {
      descricao: referencia.descricao ?? undefined,
      dataMovimento: referencia.data_movimento ?? undefined,
    });
    if (!movimento) {
      throw new ErroReferenciaNaoEncontrada(
        "lançamento",
        referencia.descricao ?? referencia.data_movimento ?? "não especificado",
      );
    }
    return {
      descricao: movimento.descricao,
      dataMovimento: movimento.dataMovimento,
      valor: Number(movimento.valor),
    };
  }

  private montar_plasticos_opcionais(
    numero: string | null | undefined,
    validade: string | null | undefined,
    cvv: string | null | undefined,
  ): { final4?: string; dadosPlasticosCifrados?: string } {
    const temAlgum = numero != null || validade != null || cvv != null;
    if (!temAlgum) return {};
    if (!numero || !validade || !cvv) {
      throw new ErroDadosIncompletos(
        "CRIAR_CARTAO",
        "número, validade (MM/AA) e CVV juntos se for salvar os dados do plástico",
      );
    }
    try {
      return preparar_persistencia_plasticos({ numero, validade, cvv });
    } catch (erro) {
      if (erro instanceof ErroDadosPlasticosInvalidos) throw erro;
      throw erro;
    }
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
    const categoria = await this.buscar_ou_criar_categoria(usuarioId, nome ?? NOME_CATEGORIA_PADRAO, tipoSugerido);
    return categoria.id;
  }

  private async resolver_ou_criar_pessoa(usuarioId: string, nome: string | null | undefined): Promise<string | undefined> {
    if (!nome) return undefined;
    const existente = await this.repositorio.buscarPessoaPorNome(usuarioId, nome);
    const pessoa = existente ?? (await this.repositorio.criarPessoa(usuarioId, nome, "cliente"));
    return pessoa.id;
  }
}
