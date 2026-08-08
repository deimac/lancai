import { and, count, desc, eq, ilike, ne, sql } from "drizzle-orm";
import {
  cartao as cartaoTabela,
  categoria as categoriaTabela,
  conta as contaTabela,
  garantir_workspace_do_usuario,
  movimento as movimentoTabela,
  obter_banco,
  pessoa as pessoaTabela,
} from "@lancai/banco";
import type { Cartao, Categoria, Conta, Movimento, Pessoa } from "@lancai/banco";
import { calcularMelhorDiaCompra, paraColuna } from "@lancai/tipos";
import type { EntradaAtualizarCartao, EntradaAtualizarConta, EntradaCriarCartao, EntradaCriarConta } from "@lancai/tipos";
import { normalizar_codigo_busca } from "./codigo-movimento";
import { chave_descricao_lancamento, descricao_corresponde_busca } from "./normalizar-descricao";
import type {
  CriterioMovimentoSimilar,
  ReferenciaMovimentoParaCorrecao,
  RepositorioContexto,
} from "./repositorio-contexto";

export class RepositorioContextoDrizzle implements RepositorioContexto {
  private get banco() {
    return obter_banco();
  }

  async listarContas(usuarioId: string): Promise<Conta[]> {
    return this.banco
      .select()
      .from(contaTabela)
      .where(and(eq(contaTabela.usuarioId, usuarioId), eq(contaTabela.ativo, true)));
  }

  async listarCartoes(usuarioId: string): Promise<Cartao[]> {
    return this.banco
      .select()
      .from(cartaoTabela)
      .where(and(eq(cartaoTabela.usuarioId, usuarioId), eq(cartaoTabela.ativo, true)));
  }

  async listarCategorias(usuarioId: string): Promise<Categoria[]> {
    return this.banco
      .select()
      .from(categoriaTabela)
      .where(and(eq(categoriaTabela.usuarioId, usuarioId), eq(categoriaTabela.ativo, true)));
  }

  async listarPessoas(usuarioId: string): Promise<Pessoa[]> {
    return this.banco
      .select()
      .from(pessoaTabela)
      .where(and(eq(pessoaTabela.usuarioId, usuarioId), eq(pessoaTabela.ativo, true)));
  }

  async buscarContaPorNome(usuarioId: string, nome: string): Promise<Conta | undefined> {
    const linhas = await this.banco
      .select()
      .from(contaTabela)
      .where(
        and(eq(contaTabela.usuarioId, usuarioId), eq(contaTabela.ativo, true), ilike(contaTabela.nome, `%${nome}%`)),
      )
      .limit(1);
    return linhas[0];
  }

  async buscarCartaoPorNome(usuarioId: string, nome: string): Promise<Cartao | undefined> {
    const linhas = await this.banco
      .select()
      .from(cartaoTabela)
      .where(
        and(eq(cartaoTabela.usuarioId, usuarioId), eq(cartaoTabela.ativo, true), ilike(cartaoTabela.nome, `%${nome}%`)),
      )
      .limit(1);
    return linhas[0];
  }

  async buscarCategoriaPorNome(usuarioId: string, nome: string): Promise<Categoria | undefined> {
    const linhas = await this.banco
      .select()
      .from(categoriaTabela)
      .where(and(eq(categoriaTabela.usuarioId, usuarioId), ilike(categoriaTabela.nome, nome)))
      .limit(1);
    return linhas[0];
  }

  async buscarPessoaPorNome(usuarioId: string, nome: string): Promise<Pessoa | undefined> {
    const linhas = await this.banco
      .select()
      .from(pessoaTabela)
      .where(and(eq(pessoaTabela.usuarioId, usuarioId), ilike(pessoaTabela.nome, nome)))
      .limit(1);
    return linhas[0];
  }

  async criarCategoria(usuarioId: string, nome: string, tipo: Categoria["tipo"]): Promise<Categoria> {
    const workspaceId = await garantir_workspace_do_usuario(this.banco, usuarioId);
    const linhas = await this.banco
      .insert(categoriaTabela)
      .values({ usuarioId, workspaceId, nome, tipo })
      .returning();
    const categoria = linhas[0];
    if (!categoria) throw new Error("Falha ao criar categoria automaticamente.");
    return categoria;
  }

  async criarPessoa(usuarioId: string, nome: string, tipo: Pessoa["tipo"]): Promise<Pessoa> {
    const workspaceId = await garantir_workspace_do_usuario(this.banco, usuarioId);
    const linhas = await this.banco
      .insert(pessoaTabela)
      .values({ usuarioId, workspaceId, nome, tipo })
      .returning();
    const pessoa = linhas[0];
    if (!pessoa) throw new Error("Falha ao criar pessoa automaticamente.");
    return pessoa;
  }

  async criarConta(dados: EntradaCriarConta): Promise<Conta> {
    const linhas = await this.banco
      .insert(contaTabela)
      .values({
        nome: dados.nome,
        perfil: dados.perfil,
        usuarioId: dados.usuarioId,
        workspaceId: await garantir_workspace_do_usuario(this.banco, dados.usuarioId),
        saldoInicial: String(dados.saldoInicial),
        saldoAtual: String(dados.saldoInicial),
      })
      .returning();
    const conta = linhas[0];
    if (!conta) throw new Error("Falha ao criar conta.");
    return conta;
  }

  async criarCartao(dados: EntradaCriarCartao): Promise<Cartao> {
    const linhas = await this.banco
      .insert(cartaoTabela)
      .values({
        nome: dados.nome,
        workspaceId: await garantir_workspace_do_usuario(this.banco, dados.usuarioId),
        limite: String(dados.limite),
        fechamento: dados.fechamento,
        vencimento: dados.vencimento,
        melhorDiaCompra: calcularMelhorDiaCompra(dados.fechamento),
        perfil: dados.perfil,
        modalidade: dados.modalidade ?? (dados.contaId ? "multiplo" : "credito"),
        contaId: dados.contaId,
        usuarioId: dados.usuarioId,
        final4: dados.final4,
        dadosPlasticosCifrados: dados.dadosPlasticosCifrados,
      })
      .returning();
    const cartao = linhas[0];
    if (!cartao) throw new Error("Falha ao criar cartão.");
    return cartao;
  }

  async atualizarConta(usuarioId: string, contaId: string, dados: EntradaAtualizarConta): Promise<Conta> {
    const valores: Partial<typeof contaTabela.$inferInsert> = { dataAtualizacao: new Date() };
    if (dados.nome != null) valores.nome = dados.nome;
    if (dados.saldoAtual != null) valores.saldoAtual = String(dados.saldoAtual);
    if (dados.perfil != null) valores.perfil = dados.perfil;
    if (dados.ativo != null) valores.ativo = dados.ativo;

    const linhas = await this.banco
      .update(contaTabela)
      .set(valores)
      .where(and(eq(contaTabela.id, contaId), eq(contaTabela.usuarioId, usuarioId)))
      .returning();
    const conta = linhas[0];
    if (!conta) throw new Error("Falha ao atualizar conta — conta não encontrada.");
    return conta;
  }

  async atualizarCartao(usuarioId: string, cartaoId: string, dados: EntradaAtualizarCartao): Promise<Cartao> {
    const valores: Partial<typeof cartaoTabela.$inferInsert> = { dataAtualizacao: new Date() };
    if (dados.nome != null) valores.nome = dados.nome;
    if (dados.limite != null) valores.limite = String(dados.limite);
    if (dados.fechamento != null) {
      valores.fechamento = dados.fechamento;
      valores.melhorDiaCompra = calcularMelhorDiaCompra(dados.fechamento);
    }
    if (dados.vencimento != null) valores.vencimento = dados.vencimento;
    if (dados.perfil != null) valores.perfil = dados.perfil;
    if (dados.modalidade != null) valores.modalidade = dados.modalidade;
    if (dados.contaId !== undefined) valores.contaId = dados.contaId;
    if (dados.ativo != null) valores.ativo = dados.ativo;
    if (dados.final4 != null) valores.final4 = dados.final4;
    if (dados.dadosPlasticosCifrados != null) valores.dadosPlasticosCifrados = dados.dadosPlasticosCifrados;

    const linhas = await this.banco
      .update(cartaoTabela)
      .set(valores)
      .where(and(eq(cartaoTabela.id, cartaoId), eq(cartaoTabela.usuarioId, usuarioId)))
      .returning();
    const cartao = linhas[0];
    if (!cartao) throw new Error("Falha ao atualizar cartão — cartão não encontrado.");
    return cartao;
  }

  async listarMovimentosParaCorrecao(
    usuarioId: string,
    referencia: ReferenciaMovimentoParaCorrecao,
  ): Promise<Movimento[]> {
    if (referencia.codigo) {
      const codigo = normalizar_codigo_busca(referencia.codigo);
      if (codigo.length >= 6) {
        const porCodigo = await this.banco
          .select()
          .from(movimentoTabela)
          .where(
            and(
              eq(movimentoTabela.usuarioId, usuarioId),
              ne(movimentoTabela.status, "cancelado"),
              sql`replace(${movimentoTabela.id}::text, '-', '') like ${`${codigo}%`}`,
            ),
          )
          .orderBy(desc(movimentoTabela.dataLancamento))
          .limit(5);
        return porCodigo;
      }
    }

    const condicoes = [eq(movimentoTabela.usuarioId, usuarioId), ne(movimentoTabela.status, "cancelado")];
    if (referencia.dataMovimento) {
      condicoes.push(eq(movimentoTabela.dataMovimento, referencia.dataMovimento));
    }

    const linhas = await this.banco
      .select()
      .from(movimentoTabela)
      .where(and(...condicoes))
      .orderBy(desc(movimentoTabela.dataLancamento))
      .limit(100);

    if (!referencia.descricao) return linhas;
    return linhas.filter((movimento) =>
      descricao_corresponde_busca(movimento.descricao, referencia.descricao!),
    );
  }

  async buscarMovimentoParaCorrecao(
    usuarioId: string,
    referencia: ReferenciaMovimentoParaCorrecao,
  ): Promise<Movimento | undefined> {
    const linhas = await this.listarMovimentosParaCorrecao(usuarioId, referencia);
    return linhas[0];
  }

  async buscarMovimentoSimilar(
    usuarioId: string,
    criterio: CriterioMovimentoSimilar,
  ): Promise<Movimento | undefined> {
    const condicoes = [
      eq(movimentoTabela.usuarioId, usuarioId),
      ne(movimentoTabela.status, "cancelado"),
      eq(movimentoTabela.dataMovimento, criterio.dataMovimento),
      eq(movimentoTabela.valor, paraColuna(criterio.valor)),
    ];
    if (criterio.cartaoId) {
      condicoes.push(eq(movimentoTabela.cartaoId, criterio.cartaoId));
    } else if (criterio.contaId) {
      condicoes.push(eq(movimentoTabela.contaId, criterio.contaId));
    }

    const linhas = await this.banco
      .select()
      .from(movimentoTabela)
      .where(and(...condicoes))
      .orderBy(desc(movimentoTabela.dataLancamento))
      .limit(20);

    const alvo = chave_descricao_lancamento(criterio.descricao);
    return linhas.find((movimento) => chave_descricao_lancamento(movimento.descricao) === alvo);
  }

  async contarMovimentosVinculadosConta(contaId: string): Promise<number> {
    const [linha] = await this.banco
      .select({ total: count() })
      .from(movimentoTabela)
      .where(and(eq(movimentoTabela.contaId, contaId), ne(movimentoTabela.status, "cancelado")));
    return Number(linha?.total ?? 0);
  }

  async contarMovimentosVinculadosCartao(cartaoId: string): Promise<number> {
    const [linha] = await this.banco
      .select({ total: count() })
      .from(movimentoTabela)
      .where(and(eq(movimentoTabela.cartaoId, cartaoId), ne(movimentoTabela.status, "cancelado")));
    return Number(linha?.total ?? 0);
  }
}
