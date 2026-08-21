import type { Movimento, NovaAuditoria, NovaRegra, NovoMovimento, Regra } from "@lancai/banco";

/**
 * Só o grupo Conhecimento chega aqui. `Partial<NovoMovimento>` é amplo demais
 * para expressar isso, então a fronteira real está em `ServicoConhecimento`,
 * que monta este objeto a partir de um schema restrito.
 */
export interface OperacaoConhecimento {
  movimentoId: string;
  campos: Partial<NovoMovimento>;
  auditoria: NovaAuditoria;
}

export type CamposAtualizarRegra = Partial<{
  nome: string;
  logicaCondicoes: Regra["logicaCondicoes"];
  condicoes: Regra["condicoes"];
  acoes: Regra["acoes"];
  ativa: boolean;
  categoriaId: string | null;
}>;

export interface RepositorioConhecimento {
  obterMovimento(id: string): Promise<Movimento | undefined>;
  obterCategoria(id: string): Promise<{ id: string; nome: string } | undefined>;
  obterPessoa(id: string): Promise<{ id: string; nome: string } | undefined>;
  /** Resolve categoria pelo nome do usuário (lista global, não por workspace). */
  buscarCategoriaPorNome(
    usuarioId: string,
    nome: string,
  ): Promise<{ id: string; nome: string } | undefined>;
  buscarPessoaPorNome(
    workspaceId: string,
    nome: string,
  ): Promise<{ id: string; nome: string } | undefined>;
  atualizarConhecimento(operacao: OperacaoConhecimento): Promise<Movimento>;
  /** Regras ativas nos workspaces do usuário, da mais específica para a mais antiga. */
  listarRegrasAtivas(workspaceIds: string[]): Promise<Regra[]>;
  /** Todas as regras dos workspaces (ativas e inativas), ativas primeiro. */
  listarRegras(workspaceIds: string[]): Promise<Regra[]>;
  criarRegra(regra: NovaRegra): Promise<Regra>;
  obterRegra(id: string): Promise<Regra | undefined>;
  atualizarRegra(id: string, campos: CamposAtualizarRegra): Promise<Regra | undefined>;
  excluirRegra(id: string): Promise<void>;
  /** IDs de movimentos (não cancelados) elegíveis para reaplicação em lote. */
  listarMovimentoIdsParaRegras(workspaceIds: string[]): Promise<string[]>;
  /** Workspaces em que o usuário é dono. */
  listarWorkspaceIdsDoUsuario(usuarioId: string): Promise<string[]>;
  /** Categorias ativas do usuário — lista que o sugeridor de IA pode escolher. */
  listarCategoriasAtivas(
    usuarioId: string,
  ): Promise<Array<{ id: string; nome: string; tipo: string }>>;
  /** Parcelas da mesma compra OF (cartão + compraEm + total). */
  listarIrmasParcelamento(movimento: Movimento): Promise<Movimento[]>;
  /**
   * Candidatos do mesmo workspace e tipo para copiar categoria
   * (a igualdade da descrição é decidida no serviço).
   */
  listarCandidatosIguais(movimento: Movimento): Promise<Movimento[]>;
}
