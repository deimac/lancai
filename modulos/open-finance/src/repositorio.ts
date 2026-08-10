import type { MotivoAtencao, StatusConexao } from "./provedor";

/**
 * Uma conexão como o módulo a conhece. `perfilPadrao` alimenta o Fato na
 * ingestão (default `pf`); PF/PJ de produto vive na conta/cartão local.
 */
export interface ConexaoRegistrada {
  id: string;
  workspaceId: string;
  criadoPor: string;
  idExterno: string;
  status: StatusConexao;
  perfilPadrao: "pf" | "pj";
}

/** Contagens do último processamento — espelho enxuto de `ResumoIngestao`. */
export interface ResumoIngestaoPersistido {
  criados: number;
  duplicados: number;
  atualizados: number;
  removidos: number;
  semDestino: number;
  paginas: number;
}

/** A conexão com o que a interface precisa mostrar, além do que a ingestão usa. */
export interface ConexaoDetalhada extends ConexaoRegistrada {
  instituicao: string | null;
  motivoAtencao: MotivoAtencao | null;
  ultimoSyncEm: Date | null;
  consentimentoExpiraEm: Date | null;
  ultimoResumoIngestao: ResumoIngestaoPersistido | null;
}

/**
 * Uma conta encontrada no provedor e o que ela virou aqui. Com `contaId` e
 * `cartaoId` nulos, a conta foi descoberta mas ninguém a associou — e
 * movimentação dela não tem onde pousar, então a ingestão a descarta.
 */
export interface ContaExternaRegistrada {
  contaExternaId: string;
  nome: string;
  tipo: string;
  contaId: string | null;
  cartaoId: string | null;
}

/** O que o provedor informou sobre uma conta, antes de qualquer associação. */
export interface ContaExternaDescoberta {
  contaExternaId: string;
  nome: string;
  tipo: string;
}

export interface EstadoConexaoParaGravar {
  status?: StatusConexao;
  motivoAtencao?: MotivoAtencao | null;
  instituicao?: string | null;
  ultimoSyncEm?: Date;
  consentimentoExpiraEm?: Date | null;
  ultimoResumoIngestao?: ResumoIngestaoPersistido | null;
}

/** Payload bruto de um webhook que falhou no `processar`. */
export interface EventoOpenFinanceComErro {
  provedor: string;
  eventoId: string;
  tipo: string;
  payload: unknown;
  erro: string;
  processadoEm: Date | null;
  dataCriacao: Date;
}

export interface RepositorioOpenFinance {
  /**
   * Grava o webhook antes de qualquer processamento. Devolve `false` quando o
   * `eventoId` já estava registrado, e é isso que descarta a retentativa do
   * provedor sem processar duas vezes.
   */
  registrarEvento(evento: {
    provedor: string;
    eventoId: string;
    tipo: string;
    payload: unknown;
  }): Promise<boolean>;

  /** Fecha o evento. `erro` preenchido é o que o cron de reprocesso procura. */
  marcarEventoProcessado(chave: {
    provedor: string;
    eventoId: string;
    erro?: string;
  }): Promise<void>;

  /**
   * Eventos cujo processamento falhou. O cron de rede de segurança lê isto
   * (não o webhook): a Pluggy já parou de retentar.
   */
  listarEventosComErro(entrada: {
    provedor: string;
    limite: number;
  }): Promise<EventoOpenFinanceComErro[]>;

  /**
   * Substitui o payload bruto por um stub, em eventos já processados sem erro
   * e mais antigos que o corte. Mantém a linha — a unicidade de `evento_id`
   * continua bloqueando retentativa tardia do provedor.
   */
  anonimizarPayloadsAntigos(entrada: {
    provedor: string;
    maisAntigosQue: Date;
    limite: number;
    stub: unknown;
  }): Promise<number>;

  obterConexao(provedor: string, idExterno: string): Promise<ConexaoRegistrada | undefined>;

  obterConexaoPorId(id: string): Promise<ConexaoDetalhada | undefined>;

  listarConexoes(workspaceIds: string | string[]): Promise<ConexaoDetalhada[]>;

  /** Idempotente por `(provedor, idExterno)`: reabrir o widget não cria conexão nova. */
  registrarConexao(conexao: {
    provedor: string;
    idExterno: string;
    workspaceId: string;
    criadoPor: string;
    instituicao?: string | null;
  }): Promise<ConexaoRegistrada>;

  listarContasExternas(conexaoId: string): Promise<ContaExternaRegistrada[]>;

  /**
   * Acha a conexão Open Finance que aponta para esta conta ou cartão local.
   * Usado ao excluir no Core para desligar a instituição inteira.
   */
  encontrarConexaoIdPorDestino(destino: {
    contaId?: string;
    cartaoId?: string;
  }): Promise<string | undefined>;

  /**
   * Apaga a conexão e o mapa de contas externas. Usado na exclusão total
   * (limpar para reconectar), não no desconectar suave.
   */
  apagarConexao(conexaoId: string): Promise<void>;

  /**
   * Registra o que o provedor encontrou, preservando as associações já feitas.
   * Conta que sumiu do provedor **não** é apagada: ela pode ter Fato associado,
   * e apagar o mapa deixaria esse Fato órfão de explicação.
   */
  sincronizarContasExternas(
    conexaoId: string,
    contas: ContaExternaDescoberta[],
  ): Promise<void>;

  definirAssociacao(
    conexaoId: string,
    contaExternaId: string,
    destino: { contaId: string | null; cartaoId: string | null },
  ): Promise<void>;

  atualizarEstadoConexao(conexaoId: string, estado: EstadoConexaoParaGravar): Promise<void>;

  /**
   * Categoria onde a movimentação pousa até o Conhecimento classificá-la. Cria se
   * faltar: uma conta conectada antes de o usuário ver a tela de categorias é
   * caso normal, e o webhook não pode falhar por isso.
   */
  garantirCategoriaNaoClassificado(workspaceId: string, usuarioId: string): Promise<string>;
}
