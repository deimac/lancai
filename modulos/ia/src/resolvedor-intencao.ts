import type { Cartao, Conta } from "@lancai/banco";
import type {
  EntradaCorrigirMovimento,
  EntradaCriarMovimento,
  IntencaoCorrigirMovimento,
  IntencaoCriarCartao,
  IntencaoCriarConta,
  IntencaoRegistrarMovimento,
} from "@lancai/tipos";
import { ErroDadosIncompletos, ErroReferenciaNaoEncontrada } from "./erros";
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

    return {
      movimentoId: movimentoAlvo.id,
      alteradoPor: criadoPor,
      campos,
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

    const contaId = await this.resolver_conta_obrigatoria(contexto.usuarioId, intencao.conta_nome, "conta vinculada ao cartão");

    return this.repositorio.criarCartao({
      nome: intencao.nome,
      limite: intencao.limite,
      fechamento: intencao.fechamento,
      vencimento: intencao.vencimento,
      perfil: intencao.perfil,
      contaId,
      usuarioId: contexto.usuarioId,
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
