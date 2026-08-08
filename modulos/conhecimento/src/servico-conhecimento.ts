import { CATEGORIA_NAO_CLASSIFICADO } from "@lancai/banco";
import { schemaAtualizarConhecimento, schemaCriarRegra } from "@lancai/tipos";
import type { EntradaAtualizarConhecimento, EntradaCriarRegra } from "@lancai/tipos";
import type { Movimento, NovaAuditoria, NovoMovimento, Regra } from "@lancai/banco";
import { ErroConhecimentoInvalido, ErroMovimentoNaoEncontrado } from "./erros";
import type { RepositorioConhecimento } from "./repositorio";
import type { SugeridorCategoria } from "./sugeridor-categoria";
import { propor_trecho_regra } from "./trecho-regra";

export type ResultadoAplicarRegra =
  | { aplicada: true; regraId: string; movimento: Movimento }
  | { aplicada: false; motivo: "protegido_pelo_usuario" | "nenhuma_casou" | "ja_aplicada" };

export type ResultadoAplicarIa =
  | { aplicada: true; movimento: Movimento; confianca: number }
  | {
      aplicada: false;
      motivo:
        | "protegido_pelo_usuario"
        | "ja_classificado"
        | "sem_categorias"
        | "sem_sugestao"
        | "categoria_invalida";
    };

export type ResultadoClassificar =
  | { etapa: "regra"; resultado: ResultadoAplicarRegra }
  | { etapa: "ia"; resultado: ResultadoAplicarIa };

export interface PropostaRegra {
  movimentoId: string;
  trecho: string;
  categoriaId: string;
  categoriaNome: string;
}

export type ResultadoCriarRegraDeCorrecao =
  | { criada: true; regra: Regra; proposta: PropostaRegra }
  | { criada: false; motivo: "sem_trecho" | "ja_existe"; proposta?: PropostaRegra; regra?: Regra };

/**
 * Enriquecimento do LançAI sobre uma movimentação: categoria, pessoa, perfil,
 * tags, observações e visibilidade em relatório.
 *
 * Nenhum método aqui aceita valor, data ou conta. Isso é deliberado: é o que
 * torna impossível, por assinatura de função, que um enriquecimento reescreva o
 * Fato Financeiro. Ver ADR-009.
 *
 * Por isso também não há verificação de `fonte`: o Conhecimento é editável em
 * qualquer movimentação, inclusive nas que vieram de instituição financeira.
 */
export class ServicoConhecimento {
  constructor(private readonly repositorio: RepositorioConhecimento) {}

  async atualizar(entradaBruta: EntradaAtualizarConhecimento): Promise<Movimento> {
    const entrada = schemaAtualizarConhecimento.parse(entradaBruta);

    const movimentoAtual = await this.repositorio.obterMovimento(entrada.movimentoId);
    if (!movimentoAtual) {
      throw new ErroMovimentoNaoEncontrado(entrada.movimentoId);
    }

    const dados = entrada.conhecimento;
    const campos: Partial<NovoMovimento> = {};

    if (dados.descricao !== undefined) campos.descricao = dados.descricao;
    if (dados.perfil !== undefined) campos.perfil = dados.perfil;
    if (dados.tags !== undefined) campos.tags = dados.tags;
    if (dados.observacoes !== undefined) campos.observacoes = dados.observacoes;
    if (dados.ignoradoEmRelatorio !== undefined) {
      campos.ignoradoEmRelatorio = dados.ignoradoEmRelatorio;
    }
    if (dados.confiancaIa !== undefined) {
      campos.confiancaIa = dados.confiancaIa === null ? null : dados.confiancaIa.toFixed(3);
    }

    if (dados.categoriaId !== undefined) {
      const categoria = await this.repositorio.obterCategoria(dados.categoriaId);
      if (!categoria) throw new ErroConhecimentoInvalido(`Categoria ${dados.categoriaId} não existe.`);
      campos.categoriaId = dados.categoriaId;
    }
    if (dados.pessoaId !== undefined) {
      const pessoa = await this.repositorio.obterPessoa(dados.pessoaId);
      if (!pessoa) throw new ErroConhecimentoInvalido(`Pessoa ${dados.pessoaId} não existe.`);
      campos.pessoaId = dados.pessoaId;
    }

    /**
     * Origem da classificação só muda quando o chamador diz (regra/IA) ou quando
     * a categoria muda sem origem — aí assume-se a pessoa. Editar tag,
     * observação ou “ignorado” não pode apagar “classificado pela regra IFOOD”.
     */
    if (dados.classificadoPor !== undefined) {
      campos.classificadoPor = dados.classificadoPor;
    } else if (dados.categoriaId !== undefined) {
      campos.classificadoPor = "usuario";
    }

    if (dados.regraId !== undefined) {
      campos.regraId = dados.regraId;
    } else if (campos.classificadoPor !== undefined && campos.classificadoPor !== "regra") {
      campos.regraId = null;
    }

    const classificacaoMudou =
      dados.classificadoPor !== undefined ||
      dados.categoriaId !== undefined ||
      dados.regraId !== undefined ||
      dados.confiancaIa !== undefined;
    if (classificacaoMudou) {
      campos.classificadoEm = new Date();
    }

    campos.alteradoPor = entrada.alteradoPor;

    const auditoria: NovaAuditoria = {
      tabela: "movimento",
      registroId: entrada.movimentoId,
      acao: "ALTERACAO",
      estadoAnterior: movimentoAtual,
      estadoAtual: { ...movimentoAtual, ...campos },
      alteradoPor: entrada.alteradoPor,
    };

    return this.repositorio.atualizarConhecimento({
      movimentoId: entrada.movimentoId,
      campos,
      auditoria,
    });
  }

  /**
   * Primeira etapa da ordem de classificação (09-REGRAS §9.1): regra manual,
   * se alguma condição casar. Nunca toca movimento com `classificado_por =
   * 'usuario'` — é a regra que impede o motor de desfazer o trabalho da pessoa.
   *
   * Idempotente: reaplicar a mesma regra não gera auditoria nova.
   */
  async aplicar_regras(movimentoId: string): Promise<ResultadoAplicarRegra> {
    const movimento = await this.repositorio.obterMovimento(movimentoId);
    if (!movimento) throw new ErroMovimentoNaoEncontrado(movimentoId);

    if (movimento.classificadoPor === "usuario") {
      return { aplicada: false, motivo: "protegido_pelo_usuario" };
    }

    const regras = await this.repositorio.listarRegrasAtivas(movimento.workspaceId);
    const casada = regras.find((regra) => regra_casa(regra, movimento));
    if (!casada) return { aplicada: false, motivo: "nenhuma_casou" };

    const perfilAlvo = casada.perfil ?? undefined;
    const jaAplicada =
      movimento.classificadoPor === "regra" &&
      movimento.regraId === casada.id &&
      movimento.categoriaId === casada.categoriaId &&
      (perfilAlvo === undefined || movimento.perfil === perfilAlvo);

    if (jaAplicada) return { aplicada: false, motivo: "ja_aplicada" };

    const atualizado = await this.atualizar({
      movimentoId,
      alteradoPor: movimento.usuarioId,
      conhecimento: {
        categoriaId: casada.categoriaId,
        ...(perfilAlvo ? { perfil: perfilAlvo } : {}),
        classificadoPor: "regra",
        regraId: casada.id,
        /** Regra ganhou: a confiança da IA, se havia, deixa de valer. */
        confiancaIa: null,
      },
    });

    return { aplicada: true, regraId: casada.id, movimento: atualizado };
  }

  /**
   * Segunda etapa da ordem de classificação (09-REGRAS §9.1): IA quando nenhuma
   * regra casa. Grava `classificado_por = ia` e `confianca_ia`. Nunca toca
   * classificação do usuário. Não inventa categoria — só escolhe da lista.
   */
  async aplicar_ia(
    movimentoId: string,
    sugeridor: SugeridorCategoria,
  ): Promise<ResultadoAplicarIa> {
    const movimento = await this.repositorio.obterMovimento(movimentoId);
    if (!movimento) throw new ErroMovimentoNaoEncontrado(movimentoId);

    if (movimento.classificadoPor === "usuario") {
      return { aplicada: false, motivo: "protegido_pelo_usuario" };
    }

    const categoriaAtual = await this.repositorio.obterCategoria(movimento.categoriaId);
    if (
      categoriaAtual &&
      categoriaAtual.nome.toLocaleLowerCase("pt-BR") !==
        CATEGORIA_NAO_CLASSIFICADO.toLocaleLowerCase("pt-BR")
    ) {
      return { aplicada: false, motivo: "ja_classificado" };
    }

    const categorias = await this.repositorio.listarCategoriasAtivas(movimento.workspaceId);
    const elegiveis = categorias.filter(
      (categoria) =>
        categoria.nome.toLocaleLowerCase("pt-BR") !==
        CATEGORIA_NAO_CLASSIFICADO.toLocaleLowerCase("pt-BR"),
    );
    if (elegiveis.length === 0) return { aplicada: false, motivo: "sem_categorias" };

    const sugestao = await sugeridor.sugerir({
      descricao: movimento.descricao,
      descricaoFonte: movimento.descricaoFonte,
      favorecidoFonte: movimento.favorecidoFonte,
      tipo: movimento.tipo,
      categorias: elegiveis.map(({ id, nome }) => ({ id, nome })),
    });
    if (!sugestao) return { aplicada: false, motivo: "sem_sugestao" };

    const escolhida = elegiveis.find((categoria) => categoria.id === sugestao.categoriaId);
    if (!escolhida) return { aplicada: false, motivo: "categoria_invalida" };

    const confianca = Math.min(1, Math.max(0, sugestao.confianca));
    const atualizado = await this.atualizar({
      movimentoId,
      alteradoPor: movimento.usuarioId,
      conhecimento: {
        categoriaId: escolhida.id,
        classificadoPor: "ia",
        regraId: null,
        confiancaIa: confianca,
      },
    });

    return { aplicada: true, movimento: atualizado, confianca };
  }

  /**
   * Ordem completa: regra primeiro; IA só no que sobra. Fail-open da IA fica
   * com o chamador (composition root) — este método propaga o erro do sugeridor.
   */
  async classificar(
    movimentoId: string,
    sugeridor: SugeridorCategoria,
  ): Promise<ResultadoClassificar> {
    const regras = await this.aplicar_regras(movimentoId);
    if (
      regras.aplicada ||
      regras.motivo === "protegido_pelo_usuario" ||
      regras.motivo === "ja_aplicada"
    ) {
      return { etapa: "regra", resultado: regras };
    }

    const ia = await this.aplicar_ia(movimentoId, sugeridor);
    return { etapa: "ia", resultado: ia };
  }

  async criar_regra(entradaBruta: EntradaCriarRegra): Promise<Regra> {
    const entrada = schemaCriarRegra.parse(entradaBruta);

    const categoria = await this.repositorio.obterCategoria(entrada.categoriaId);
    if (!categoria) {
      throw new ErroConhecimentoInvalido(`Categoria ${entrada.categoriaId} não existe.`);
    }

    return this.repositorio.criarRegra({
      workspaceId: entrada.workspaceId,
      origem: entrada.origem,
      ativa: true,
      condicaoTipo: entrada.condicaoTipo,
      condicaoValor: entrada.condicaoValor.trim(),
      categoriaId: entrada.categoriaId,
      perfil: entrada.perfil ?? null,
    });
  }

  async listar_regras(workspaceId: string): Promise<Regra[]> {
    return this.repositorio.listarRegras(workspaceId);
  }

  async definir_ativa_regra(regraId: string, ativa: boolean): Promise<Regra> {
    const existente = await this.repositorio.obterRegra(regraId);
    if (!existente) throw new ErroConhecimentoInvalido(`Regra ${regraId} não existe.`);
    const atualizada = await this.repositorio.atualizarRegra(regraId, { ativa });
    if (!atualizada) throw new ErroConhecimentoInvalido(`Falha ao atualizar regra ${regraId}.`);
    return atualizada;
  }

  /**
   * Monta a proposta "IFOOD → Restaurantes" a partir do movimento já classificado.
   * Sem trecho útil, sem categoria ou com regra idêntica já ativa, não há o que oferecer.
   */
  async propor_regra_de_movimento(movimentoId: string): Promise<PropostaRegra | null> {
    const movimento = await this.repositorio.obterMovimento(movimentoId);
    if (!movimento) throw new ErroMovimentoNaoEncontrado(movimentoId);

    const trecho = propor_trecho_regra(movimento);
    if (!trecho) return null;

    const categoria = await this.repositorio.obterCategoria(movimento.categoriaId);
    if (!categoria) return null;

    const existentes = await this.repositorio.listarRegrasAtivas(movimento.workspaceId);
    const jaExiste = existentes.some(
      (regra) =>
        regra.condicaoTipo === "descricao_contem" &&
        regra.condicaoValor.toLocaleLowerCase("pt-BR") === trecho.toLocaleLowerCase("pt-BR") &&
        regra.categoriaId === categoria.id,
    );
    if (jaExiste) return null;

    return {
      movimentoId: movimento.id,
      trecho,
      categoriaId: categoria.id,
      categoriaNome: categoria.nome,
    };
  }

  /**
   * O "sim" do "virar regra?". Origem `aprendizado_conversa`. Idempotente: se já
   * existe regra ativa com o mesmo trecho e categoria, devolve a existente.
   */
  async criar_regra_a_partir_de_correcao(
    movimentoId: string,
  ): Promise<ResultadoCriarRegraDeCorrecao> {
    const movimento = await this.repositorio.obterMovimento(movimentoId);
    if (!movimento) throw new ErroMovimentoNaoEncontrado(movimentoId);

    const trecho = propor_trecho_regra(movimento);
    if (!trecho) return { criada: false, motivo: "sem_trecho" };

    const categoria = await this.repositorio.obterCategoria(movimento.categoriaId);
    if (!categoria) return { criada: false, motivo: "sem_trecho" };

    const proposta: PropostaRegra = {
      movimentoId: movimento.id,
      trecho,
      categoriaId: categoria.id,
      categoriaNome: categoria.nome,
    };

    const existentes = await this.repositorio.listarRegrasAtivas(movimento.workspaceId);
    const igual = existentes.find(
      (regra) =>
        regra.condicaoTipo === "descricao_contem" &&
        regra.condicaoValor.toLocaleLowerCase("pt-BR") ===
          proposta.trecho.toLocaleLowerCase("pt-BR") &&
        regra.categoriaId === proposta.categoriaId,
    );
    if (igual) return { criada: false, motivo: "ja_existe", proposta, regra: igual };

    const regra = await this.criar_regra({
      workspaceId: movimento.workspaceId,
      origem: "aprendizado_conversa",
      condicaoValor: proposta.trecho,
      categoriaId: proposta.categoriaId,
    });

    return { criada: true, regra, proposta };
  }
}

export { propor_trecho_regra } from "./trecho-regra";

/**
 * Casa a condição contra o texto que o usuário vê e o que a instituição
 * mandou. Sem `descricao_fonte`, a regra "IFOOD" falharia em tudo que ainda
 * está com a descrição bruta do banco — que é exatamente o caso da ingestão.
 */
export function regra_casa(
  regra: Pick<Regra, "condicaoTipo" | "condicaoValor">,
  movimento: Pick<Movimento, "descricao" | "descricaoFonte" | "favorecidoFonte">,
): boolean {
  if (regra.condicaoTipo !== "descricao_contem") return false;

  const trecho = regra.condicaoValor.trim().toLocaleLowerCase("pt-BR");
  if (!trecho) return false;

  const campos = [movimento.descricao, movimento.descricaoFonte, movimento.favorecidoFonte ?? ""];
  return campos.some((campo) => campo.toLocaleLowerCase("pt-BR").includes(trecho));
}
