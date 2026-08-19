import { CATEGORIA_NAO_CLASSIFICADO } from "@lancai/banco";
import {
  schemaAtualizarConhecimento,
  schemaAtualizarRegra,
  schemaCriarRegra,
} from "@lancai/tipos";
import type {
  AcaoRegra,
  EntradaAtualizarConhecimento,
  EntradaAtualizarRegra,
  EntradaCriarRegra,
} from "@lancai/tipos";
import type { Movimento, NovaAuditoria, NovoMovimento, Regra } from "@lancai/banco";
import {
  acoes_da_regra,
  categoria_id_da_regra,
  regra_casa,
} from "./avaliar-regra";
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
 * Enriquecimento do Lançai sobre uma movimentação: categoria, pessoa, tipo de gasto,
 * tags, observações e visibilidade em relatório.
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
    if (dados.tipoGasto !== undefined) campos.tipoGasto = dados.tipoGasto;
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

  async aplicar_regras(
    movimentoId: string,
    opcoes: { sobrescreverUsuario?: boolean } = {},
  ): Promise<ResultadoAplicarRegra> {
    const movimento = await this.repositorio.obterMovimento(movimentoId);
    if (!movimento) throw new ErroMovimentoNaoEncontrado(movimentoId);

    if (movimento.classificadoPor === "usuario" && !opcoes.sobrescreverUsuario) {
      return { aplicada: false, motivo: "protegido_pelo_usuario" };
    }

    const regras = await this.repositorio.listarRegrasAtivas(
      await this.workspaces_do_usuario(movimento.usuarioId, movimento.workspaceId),
    );
    const casada = regras.find((regra) => regra_casa(regra, movimento));
    if (!casada) return { aplicada: false, motivo: "nenhuma_casou" };

    const conhecimento = await this.montar_conhecimento_das_acoes(casada, movimento);
    if (Object.keys(conhecimento).length === 0) {
      return { aplicada: false, motivo: "nenhuma_casou" };
    }

    if (
      movimento.classificadoPor === "regra" &&
      movimento.regraId === casada.id &&
      conhecimento_ja_aplicado(conhecimento, movimento)
    ) {
      return { aplicada: false, motivo: "ja_aplicada" };
    }

    const atualizado = await this.atualizar({
      movimentoId,
      alteradoPor: movimento.usuarioId,
      conhecimento: {
        ...conhecimento,
        classificadoPor: "regra",
        regraId: casada.id,
        confiancaIa: null,
      },
    });

    return { aplicada: true, regraId: casada.id, movimento: atualizado };
  }

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

  /**
   * Reaplica regras ativas no histórico dos workspaces.
   * Com o checkbox “aplicar a existentes”, sobrescreve também classificação
   * marcada como usuário (ex.: padrão “Outros” do chat) — é opt-in explícito.
   */
  async aplicar_regras_existentes(workspaceIds: string[]): Promise<{ aplicadas: number }> {
    const ids = await this.repositorio.listarMovimentoIdsParaRegras(workspaceIds);
    let aplicadas = 0;
    for (const id of ids) {
      const resultado = await this.aplicar_regras(id, { sobrescreverUsuario: true });
      if (resultado.aplicada) aplicadas += 1;
    }
    return { aplicadas };
  }

  async criar_regra(entradaBruta: EntradaCriarRegra): Promise<Regra> {
    const entrada = schemaCriarRegra.parse(entradaBruta);
    await this.validar_acoes(entrada.acoes);

    const categoriaId = entrada.acoes.find((a) => a.tipo === "definir_categoria");
    const criada = await this.repositorio.criarRegra({
      workspaceId: entrada.workspaceId,
      origem: entrada.origem,
      ativa: entrada.ativa ?? true,
      nome: entrada.nome.trim(),
      logicaCondicoes: entrada.logicaCondicoes,
      condicoes: entrada.condicoes,
      acoes: entrada.acoes,
      condicaoTipo: null,
      condicaoValor: null,
      categoriaId:
        categoriaId && categoriaId.tipo === "definir_categoria" ? categoriaId.categoriaId : null,
      perfil: null,
    });

    return criada;
  }

  async atualizar_regra(regraId: string, entradaBruta: EntradaAtualizarRegra): Promise<Regra> {
    const entrada = schemaAtualizarRegra.parse(entradaBruta);
    const existente = await this.repositorio.obterRegra(regraId);
    if (!existente) throw new ErroConhecimentoInvalido(`Regra ${regraId} não existe.`);

    if (entrada.acoes) await this.validar_acoes(entrada.acoes);

    const categoriaAcao = (entrada.acoes ?? acoes_da_regra(existente)).find(
      (a) => a.tipo === "definir_categoria",
    );

    const atualizada = await this.repositorio.atualizarRegra(regraId, {
      ...(entrada.nome !== undefined ? { nome: entrada.nome.trim() } : {}),
      ...(entrada.logicaCondicoes !== undefined ? { logicaCondicoes: entrada.logicaCondicoes } : {}),
      ...(entrada.condicoes !== undefined ? { condicoes: entrada.condicoes } : {}),
      ...(entrada.acoes !== undefined ? { acoes: entrada.acoes } : {}),
      ...(entrada.ativa !== undefined ? { ativa: entrada.ativa } : {}),
      categoriaId:
        categoriaAcao && categoriaAcao.tipo === "definir_categoria"
          ? categoriaAcao.categoriaId
          : existente.categoriaId,
    });
    if (!atualizada) throw new ErroConhecimentoInvalido(`Falha ao atualizar regra ${regraId}.`);

    return atualizada;
  }

  async excluir_regra(regraId: string): Promise<void> {
    const existente = await this.repositorio.obterRegra(regraId);
    if (!existente) throw new ErroConhecimentoInvalido(`Regra ${regraId} não existe.`);
    await this.repositorio.excluirRegra(regraId);
  }

  async listar_regras(workspaceIds: string[]): Promise<Regra[]> {
    return this.repositorio.listarRegras(workspaceIds);
  }

  async definir_ativa_regra(regraId: string, ativa: boolean): Promise<Regra> {
    return this.atualizar_regra(regraId, { ativa });
  }

  async propor_regra_de_movimento(movimentoId: string): Promise<PropostaRegra | null> {
    const movimento = await this.repositorio.obterMovimento(movimentoId);
    if (!movimento) throw new ErroMovimentoNaoEncontrado(movimentoId);

    const trecho = propor_trecho_regra(movimento);
    if (!trecho) return null;

    const categoria = await this.repositorio.obterCategoria(movimento.categoriaId);
    if (!categoria) return null;

    const workspaceIds = await this.workspaces_do_usuario(movimento.usuarioId, movimento.workspaceId);
    const existentes = await this.repositorio.listarRegrasAtivas(workspaceIds);
    const jaExiste = existentes.some((regra) => regra_simples_igual(regra, trecho, categoria.id));
    if (jaExiste) return null;

    return {
      movimentoId: movimento.id,
      trecho,
      categoriaId: categoria.id,
      categoriaNome: categoria.nome,
    };
  }

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

    const workspaceIds = await this.workspaces_do_usuario(movimento.usuarioId, movimento.workspaceId);
    const existentes = await this.repositorio.listarRegrasAtivas(workspaceIds);
    const igual = existentes.find((regra) =>
      regra_simples_igual(regra, proposta.trecho, proposta.categoriaId),
    );
    if (igual) return { criada: false, motivo: "ja_existe", proposta, regra: igual };

    const regra = await this.criar_regra({
      workspaceId: movimento.workspaceId,
      origem: "aprendizado_conversa",
      nome: `"${proposta.trecho}" → ${proposta.categoriaNome}`,
      logicaCondicoes: "ou",
      condicoes: [{ campo: "descricao", operador: "contem", valor: proposta.trecho }],
      acoes: [{ tipo: "definir_categoria", categoriaId: proposta.categoriaId }],
    });

    return { criada: true, regra, proposta };
  }

  private async validar_acoes(acoes: AcaoRegra[]): Promise<void> {
    for (const acao of acoes) {
      if (acao.tipo === "definir_categoria") {
        const categoria = await this.repositorio.obterCategoria(acao.categoriaId);
        if (!categoria) {
          throw new ErroConhecimentoInvalido(`Categoria ${acao.categoriaId} não existe.`);
        }
      }
      if (acao.tipo === "definir_beneficiario") {
        const pessoa = await this.repositorio.obterPessoa(acao.pessoaId);
        if (!pessoa) {
          throw new ErroConhecimentoInvalido(`Pessoa ${acao.pessoaId} não existe.`);
        }
      }
    }
  }

  private async workspaces_do_usuario(
    usuarioId: string,
    fallbackWorkspaceId: string,
  ): Promise<string[]> {
    const ids = await this.repositorio.listarWorkspaceIdsDoUsuario(usuarioId);
    return ids.length > 0 ? ids : [fallbackWorkspaceId];
  }

  private async montar_conhecimento_das_acoes(
    regra: Regra,
    movimento: Movimento,
  ): Promise<EntradaAtualizarConhecimento["conhecimento"]> {
    const conhecimento: EntradaAtualizarConhecimento["conhecimento"] = {};
    for (const acao of acoes_da_regra(regra)) {
      switch (acao.tipo) {
        case "definir_categoria": {
          const origem = await this.repositorio.obterCategoria(acao.categoriaId);
          if (!origem) break;
          const local = await this.repositorio.buscarCategoriaPorNome(
            movimento.workspaceId,
            origem.nome,
          );
          if (local) conhecimento.categoriaId = local.id;
          break;
        }
        case "definir_beneficiario": {
          const origem = await this.repositorio.obterPessoa(acao.pessoaId);
          if (!origem) break;
          const local = await this.repositorio.buscarPessoaPorNome(
            movimento.workspaceId,
            origem.nome,
          );
          if (local) conhecimento.pessoaId = local.id;
          break;
        }
        case "adicionar_tags_notas": {
          if (acao.tags?.length) {
            const atuais = new Set(movimento.tags ?? []);
            for (const tag of acao.tags) atuais.add(tag);
            conhecimento.tags = [...atuais];
          }
          if (acao.observacoes !== undefined) {
            conhecimento.observacoes = acao.observacoes;
          }
          break;
        }
        case "ignorar_transacao":
          conhecimento.ignoradoEmRelatorio = true;
          break;
        case "definir_perfil":
          conhecimento.tipoGasto = acao.perfil;
          break;
      }
    }
    return conhecimento;
  }
}

export { propor_trecho_regra } from "./trecho-regra";
export { regra_casa, categoria_id_da_regra, acoes_da_regra, condicoes_da_regra } from "./avaliar-regra";

function regra_simples_igual(regra: Regra, trecho: string, categoriaId: string): boolean {
  const cat = categoria_id_da_regra(regra);
  if (cat !== categoriaId) return false;
  const condicoes = regra.condicoes ?? [];
  if (condicoes.length === 1) {
    const c = condicoes[0];
    return (
      c?.campo === "descricao" &&
      c.operador === "contem" &&
      c.valor.toLocaleLowerCase("pt-BR") === trecho.toLocaleLowerCase("pt-BR")
    );
  }
  return (
    regra.condicaoTipo === "descricao_contem" &&
    (regra.condicaoValor ?? "").toLocaleLowerCase("pt-BR") === trecho.toLocaleLowerCase("pt-BR")
  );
}

function conhecimento_ja_aplicado(
  conhecimento: EntradaAtualizarConhecimento["conhecimento"],
  movimento: Movimento,
): boolean {
  if (conhecimento.categoriaId !== undefined && movimento.categoriaId !== conhecimento.categoriaId) {
    return false;
  }
  if (conhecimento.pessoaId !== undefined && movimento.pessoaId !== conhecimento.pessoaId) {
    return false;
  }
  if (conhecimento.tipoGasto !== undefined && movimento.tipoGasto !== conhecimento.tipoGasto) {
    return false;
  }
  if (conhecimento.ignoradoEmRelatorio === true && !movimento.ignoradoEmRelatorio) {
    return false;
  }
  if (conhecimento.tags?.some((t) => !(movimento.tags ?? []).includes(t))) {
    return false;
  }
  if (
    conhecimento.observacoes !== undefined &&
    movimento.observacoes !== conhecimento.observacoes
  ) {
    return false;
  }
  return true;
}
