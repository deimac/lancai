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
  obterPessoa(id: string): Promise<{ id: string } | undefined>;
  atualizarConhecimento(operacao: OperacaoConhecimento): Promise<Movimento>;
  /** Regras ativas do workspace, da mais específica para a mais antiga. */
  listarRegrasAtivas(workspaceId: string): Promise<Regra[]>;
  /** Todas as regras do workspace (ativas e inativas), ativas primeiro. */
  listarRegras(workspaceId: string): Promise<Regra[]>;
  criarRegra(regra: NovaRegra): Promise<Regra>;
  obterRegra(id: string): Promise<Regra | undefined>;
  atualizarRegra(id: string, campos: CamposAtualizarRegra): Promise<Regra | undefined>;
  excluirRegra(id: string): Promise<void>;
  /** IDs de movimentos do workspace elegíveis para reaplicação de regras. */
  listarMovimentoIdsParaRegras(workspaceId: string): Promise<string[]>;
  /** Categorias ativas do workspace — lista que o sugeridor de IA pode escolher. */
  listarCategoriasAtivas(
    workspaceId: string,
  ): Promise<Array<{ id: string; nome: string; tipo: string }>>;
}
