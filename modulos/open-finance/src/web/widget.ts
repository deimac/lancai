/**
 * O que a tela precisa para abrir o widget de conexão de um provedor.
 *
 * Widget de Open Finance é inerentemente específico do provedor: cada agregador
 * tem o seu, com SDK próprio. Isso não pode virar desculpa para espalhar o nome
 * do provedor pelo frontend, então o lançador mora aqui, dentro do módulo, e a
 * tela chama pelo identificador que a API devolveu — do mesmo jeito que
 * `criar_provedor_open_finance` resolve o adaptador de servidor pelo nome.
 *
 * O ganho é concreto: trocar de provedor mexe neste diretório e em mais nenhum.
 */
export interface PedidoDeConexao {
  /** Token de curta duração criado pela API. Não é credencial: não lê dados. */
  token: string;
  /**
   * Identificador da conexão no provedor, entregue quando o usuário conclui.
   * É com ele que a tela chama `POST /open-finance/conexoes`.
   */
  aoConcluir: (conexaoExterna: string) => void;
  aoFalhar: (mensagem: string) => void;
  /** Chamado quando o usuário fecha o widget sem terminar. */
  aoFechar?: () => void;
  /**
   * Reconexão: presente quando o consentimento venceu ou a credencial mudou.
   * Sem isto o widget cria uma conexão nova em vez de consertar a que existe, e
   * a conta associada ficaria órfã de um lado e duplicada do outro.
   */
  conexaoExterna?: string;
  /**
   * Inclui as instituições de mentira do ambiente de teste do provedor.
   * Só ligar com `VITE_OPEN_FINANCE_INCLUDE_SANDBOX=true`.
   */
  incluirSandbox?: boolean;
  /** Instituições a listar; sem isto o widget mostra tudo, inclusive Meu Pluggy. */
  conectorIds?: number[];
}

/** Fecha o widget. A tela guarda para poder desmontar sem deixar iframe órfão. */
export type WidgetAberto = { fechar: () => void };

export type LancadorDeWidget = (pedido: PedidoDeConexao) => Promise<WidgetAberto>;
