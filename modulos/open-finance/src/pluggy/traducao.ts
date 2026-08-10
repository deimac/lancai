import type { StatusFonte } from "@lancai/tipos";
import type {
  ContaExterna,
  MotivoAtencao,
  MovimentacaoExterna,
  StatusConexao,
} from "../provedor";
import type { ParcelamentoFonte } from "@lancai/tipos";
import type { ContaPluggy, ItemPluggy, TransacaoPluggy } from "./tipos";

/**
 * Onde o vocabulário da Pluggy morre. Tudo aqui é função pura, sem I/O, para que
 * o mapeamento seja testável sem rede — é a parte que mais erra em silêncio e a
 * que menos precisa de infraestrutura para verificar.
 */

export function traduzir_conta(conta: ContaPluggy): ContaExterna {
  const credito = conta.creditData;
  return {
    idExterno: conta.id,
    nome: conta.marketingName ?? conta.name ?? conta.number ?? conta.id,
    /**
     * `subtype` é mais específico que `type` (CHECKING_ACCOUNT contra BANK) e é
     * o que ajuda o usuário a reconhecer a conta na tela de associação.
     */
    tipo: conta.subtype ?? conta.type ?? "DESCONHECIDO",
    saldo: conta.balance ?? undefined,
    limite: numero_finito(credito?.creditLimit),
    fechamento: dia_do_mes(credito?.balanceCloseDate),
    vencimento: dia_do_mes(credito?.balanceDueDate),
  };
}

function numero_finito(valor: number | null | undefined): number | undefined {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : undefined;
}

/** Extrai o dia do mês sem deslocar por fuso (datas Pluggy vêm como YYYY-MM-DD). */
function dia_do_mes(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (match) {
    const dia = Number(match[3]);
    return dia >= 1 && dia <= 31 ? dia : undefined;
  }
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return undefined;
  const dia = data.getUTCDate();
  return dia >= 1 && dia <= 31 ? dia : undefined;
}

export function traduzir_transacao(transacao: TransacaoPluggy): MovimentacaoExterna {
  const favorecido = transacao.merchant?.name ?? transacao.paymentData?.receiver?.name ?? undefined;
  const statusFonte = traduzir_status_transacao(transacao.status);

  return {
    idExterno: transacao.id,
    contaExternaId: transacao.accountId,
    /**
     * Em parcelas PENDING o `date` costuma repetir a data da compra; o período
     * da fatura prevista (`billForecastDate`) espalha as parcelas no extrato.
     */
    ocorridoEm: data_do_movimento(transacao, statusFonte),
    /** `amount` vem com sinal; a direção mora em `tipo`. */
    valor: Math.abs(transacao.amount),
    /** A Pluggy já normaliza a inversão do cartão: compra é sempre DEBIT. */
    tipo: transacao.type === "CREDIT" ? "receita" : "despesa",
    /**
     * `descriptionRaw` é o texto do banco e `description` é a versão limpa da
     * Pluggy. A separação é a mesma que fazemos entre Fato e Conhecimento, então
     * o cru vira Fato e o limpo fica de ponto de partida para o Conhecimento.
     */
    descricaoFonte: transacao.descriptionRaw ?? transacao.description ?? "(sem descrição)",
    favorecidoFonte: favorecido ?? undefined,
    statusFonte,
    parcelamento: traduzir_parcelamento(transacao.creditCardMetadata),
  };
}

/**
 * Para parcela ainda não faturada, prefere o mês previsto da fatura (dia 1).
 * Confirmadas seguem o `date` que a instituição/Pluggy já amarra à fatura.
 */
function data_do_movimento(transacao: TransacaoPluggy, status: StatusFonte): string {
  const forecast = transacao.creditCardMetadata?.billForecastDate;
  if (status === "pendente" && forecast && /^\d{4}-\d{2}$/.test(forecast)) {
    return `${forecast}-01`;
  }
  return transacao.date.slice(0, 10);
}

/**
 * Número e total são o que faz o registro valer alguma coisa: sem os dois, não
 * dá para dizer "3 de 10", e uma parcela solta não informa nada que a própria
 * transação já não diga. Valor e data da compra são opcionais porque nem todo
 * conector preenche, e perder o parcelamento inteiro por falta deles seria pior.
 */
function traduzir_parcelamento(
  metadados: TransacaoPluggy["creditCardMetadata"],
): ParcelamentoFonte | undefined {
  const numero = metadados?.installmentNumber;
  const total = metadados?.totalInstallments;
  if (!numero || !total) return undefined;

  return {
    numero,
    total,
    valorTotal: metadados?.totalAmount ?? undefined,
    compraEm: metadados?.purchaseDate?.slice(0, 10) ?? undefined,
  };
}

function traduzir_status_transacao(status: string | undefined): StatusFonte {
  /**
   * Só `PENDING` é pendente. Status desconhecido cai em confirmado porque a
   * Pluggy entrega `POSTED` na esmagadora maioria e tratar o desconhecido como
   * pendente esconderia o gasto do saldo do usuário.
   */
  return status === "PENDING" ? "pendente" : "confirmado";
}

export function traduzir_status_item(item: ItemPluggy): StatusConexao {
  switch (item.status) {
    case "UPDATED":
      return "ativa";
    case "UPDATING":
    case "MERGING":
      return "sincronizando";
    case "LOGIN_ERROR":
    case "OUTDATED":
    case "WAITING_USER_INPUT":
    case "WAITING_USER_ACTION":
      return "precisa_atencao";
    case "DELETED":
      return "removida";
    default:
      /**
       * Status que não conhecemos vira "precisa atenção" e não "ativa". Errar
       * para o lado de pedir atenção mostra um aviso a mais; errar para o lado
       * de ativa faz o usuário confiar num extrato que parou de atualizar.
       */
      return "precisa_atencao";
  }
}

/**
 * Os códigos de erro do Open Finance na Pluggy, traduzidos para o que o usuário
 * precisa fazer. Confundir credencial inválida com erro do provedor é o pior
 * erro possível aqui: manda a pessoa esperar quando ela precisa reconectar.
 */
export function traduzir_motivo(codigo: string | null | undefined): MotivoAtencao {
  switch (codigo) {
    case "INVALID_CREDENTIALS":
    case "INVALID_CREDENTIALS_MFA":
    case "ACCOUNT_LOCKED":
      return "credencial_invalida";
    case "USER_AUTHORIZATION_REVOKED":
    case "USER_AUTHORIZATION_NOT_GRANTED":
      return "consentimento_revogado";
    case "USER_AUTHORIZATION_PENDING":
    case "USER_INPUT_TIMEOUT":
    case "ACCOUNT_NEEDS_ACTION":
      return "aguardando_usuario";
    default:
      return "erro_no_provedor";
  }
}

export function traduzir_data(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data;
}
