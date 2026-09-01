/**
 * As formas que a Pluggy devolve, só nos campos que usamos. A API evolui
 * acrescentando campo sem versionar, então tudo aqui é parcial de propósito:
 * exigir o formato inteiro faria um campo novo do provedor quebrar a ingestão.
 */

export interface RespostaPaginada<T> {
  results: T[];
  /** Query string relativa (`?accountId=...&after=...`). Ausente no fim. */
  next?: string | null;
}

export interface ContaPluggy {
  id: string;
  type?: string;
  subtype?: string;
  name?: string;
  marketingName?: string | null;
  number?: string | null;
  balance?: number | null;
  /** Presente em cartão de crédito — limite, datas de fatura etc. */
  creditData?: {
    creditLimit?: number | null;
    availableCreditLimit?: number | null;
    balanceCloseDate?: string | null;
    balanceDueDate?: string | null;
    minimumPayment?: number | null;
    brand?: string | null;
    level?: string | null;
  } | null;
}

export interface FaturaPluggy {
  id: string;
  dueDate?: string | null;
  billClosingDate?: string | null;
  totalAmount?: number | null;
}

export interface TransacaoPluggy {
  id: string;
  accountId: string;
  description?: string | null;
  descriptionRaw?: string | null;
  amount: number;
  /**
   * Valor na moeda da conta (BRL no cartão brasileiro). Só vem em compra
   * internacional — `amount` nesse caso é a moeda original (USD, EUR…).
   */
  amountInAccountCurrency?: number | null;
  /** ISO da moeda de `amount` (BRL, USD…). */
  currencyCode?: string | null;
  date: string;
  type?: "DEBIT" | "CREDIT" | string;
  status?: "POSTED" | "PENDING" | string;
  merchant?: { name?: string | null } | null;
  paymentData?: { receiver?: { name?: string | null } | null } | null;
  /** Presente só em compra parcelada no cartão. */
  creditCardMetadata?: {
    installmentNumber?: number | null;
    totalInstallments?: number | null;
    totalAmount?: number | null;
    purchaseDate?: string | null;
    /**
     * Período previsto da fatura (`YYYY-MM`). Vem também em parcelas futuras
     * PENDING — ao contrário de `billId`, que só aparece depois do fechamento.
     */
    billForecastDate?: string | null;
    /** Nubank: `IOF_COMPRA_INTERNACIONAL` na linha de IOF, separado da compra. */
    feeTypeAdditionalInfo?: string | null;
  } | null;
}

export interface ItemPluggy {
  id: string;
  status?: string;
  executionStatus?: string;
  error?: { code?: string | null } | null;
  connector?: { name?: string | null } | null;
  lastUpdatedAt?: string | null;
  nextAutoSyncAt?: string | null;
  consentExpiresAt?: string | null;
}

/** O envelope comum a todo webhook. Os campos extras dependem do evento. */
export interface WebhookPluggy {
  event?: string;
  eventId?: string;
  itemId?: string;
  accountId?: string;
  transactionIds?: string[];
  createdTransactionsLink?: string;
  createdTransactionsLinkV2?: string;
  error?: { code?: string | null } | null;
}
