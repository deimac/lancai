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
    /** Competência = mês da fatura (`billForecastDate`), não a data da compra. */
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
 * Mês da fatura (`billForecastDate`) é a verdade para o navegador de competências.
 * Sem ele, parcela PENDING cai em compra + (N−1) meses — o `date` da Pluggy
 * costuma repetir a data da compra em todas as parcelas futuras.
 */
function data_do_movimento(transacao: TransacaoPluggy, status: StatusFonte): string {
  const meta = transacao.creditCardMetadata;
  const forecast = meta?.billForecastDate;
  if (forecast && /^\d{4}-\d{2}$/.test(forecast)) {
    const diaDoProvedor = transacao.date.slice(0, 10);
    if (diaDoProvedor.startsWith(`${forecast}-`)) return diaDoProvedor;
    return `${forecast}-01`;
  }

  const numero = meta?.installmentNumber;
  const compra = meta?.purchaseDate?.slice(0, 10);
  if (status === "pendente" && numero && numero >= 1 && compra && /^\d{4}-\d{2}-\d{2}$/.test(compra)) {
    return somar_meses(compra, numero - 1);
  }

  return transacao.date.slice(0, 10);
}

/** Soma meses calendário preservando o dia (ajusta 31→último dia do mês destino). */
export function somar_meses(yyyyMmDd: string, meses: number): string {
  const [anoS, mesS, diaS] = yyyyMmDd.split("-");
  const ano = Number(anoS);
  const mes = Number(mesS);
  const dia = Number(diaS);
  if (!ano || !mes || !dia) return yyyyMmDd;

  const base = new Date(Date.UTC(ano, mes - 1 + meses, 1));
  const ultimoDia = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  const diaFinal = Math.min(dia, ultimoDia);
  const y = base.getUTCFullYear();
  const m = String(base.getUTCMonth() + 1).padStart(2, "0");
  const d = String(diaFinal).padStart(2, "0");
  return `${y}-${m}-${d}`;
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
