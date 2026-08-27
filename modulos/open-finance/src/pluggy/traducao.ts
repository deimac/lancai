import type { StatusFonte } from "@lancai/tipos";
import {
  arredondar,
  data_movimento_parcela,
  datas_civis_proximas,
  descricoes_da_mesma_serie,
  dia_civil_iso,
  dia_movimento_avulsa,
  dia_provedor_iso,
  dias_calendario_entre,
  eh_credito_quitacao_no_cartao,
  garantir_parcelas_subsequentes,
  somar_meses_calendario,
} from "@lancai/tipos";
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
    /**
     * `name` é o rótulo que a Pluggy/instituição mostram na UI (ex. "Mercado Pago",
     * "Conta Corrente"). `marketingName` é nome de produto/nível e costuma divergir
     * do que o usuário vê no dashboard — por isso fica só como fallback.
     */
    nome: nome_da_conta(conta),
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

function nome_da_conta(conta: ContaPluggy): string {
  const nome = conta.name?.trim();
  if (nome) return nome;
  const marketing = conta.marketingName?.trim();
  if (marketing) return marketing;
  const numero = conta.number?.trim();
  if (numero) return numero;
  return conta.id;
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
  const ocorridoEm = data_do_movimento(transacao);

  return {
    idExterno: transacao.id,
    contaExternaId: transacao.accountId,
    /** Competência = mês da fatura (`billForecastDate`), não a data da compra. */
    ocorridoEm,
    ocorridoEmInstante: instante_do_movimento(transacao.date, ocorridoEm),
    /** Compra internacional: `amount` é USD/EUR; o fatura em real está em `amountInAccountCurrency`. */
    valor: valor_na_moeda_da_conta(transacao),
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
 * Sem ele, parcela cai em compra+(N−1) — o `date` da Pluggy costuma repetir a
 * data da compra em todas as parcelas.
 */
function data_do_movimento(transacao: TransacaoPluggy): string {
  const meta = transacao.creditCardMetadata;
  const compra = meta?.purchaseDate ? dia_provedor_iso(meta.purchaseDate) : undefined;
  const dateDia = dia_provedor_iso(transacao.date);
  const numero = meta?.installmentNumber;

  if (numero && numero >= 1) {
    return data_movimento_parcela({
      numero,
      compraEm: compra,
      billForecastDate: meta?.billForecastDate,
      dateProvedor: dateDia,
    });
  }

  return dia_movimento_avulsa(transacao.date);
}

/** Moeda da fatura no cartão brasileiro. `amount` só é BRL quando a Pluggy não diz outra coisa. */
const MOEDA_DA_CONTA = "BRL";

/**
 * IOF internacional no cartão brasileiro é ~3,5% do valor em real. Se a linha
 * `IOF INTERNACIONAL - X` do mesmo dia passa de ~8% da compra `X`, o valor da
 * compra ainda está na moeda original — gravar isso como real é o bug do
 * FlightConnections (USD 39,99 virando R$ 39,99). Não inventamos o real via
 * IOF/0,035: a taxa muda e o arredondamento da instituição não bate.
 */
const LIMIAR_IOF_SOBRE_VALOR_ESTRANGEIRO = 0.08;

/**
 * Fatura e relatórios são em real. Em compra internacional a Pluggy deixa o
 * valor original em `amount` (USD 39,99) e o convertido em
 * `amountInAccountCurrency` (R$ 224,34). Sem o segundo e sem moeda estrangeira,
 * `amount` já é BRL.
 */
export function valor_na_moeda_da_conta(transacao: TransacaoPluggy): number {
  const naConta = transacao.amountInAccountCurrency;
  if (typeof naConta === "number" && Number.isFinite(naConta)) {
    return Math.abs(naConta);
  }
  return Math.abs(transacao.amount);
}

/**
 * Compra em USD/EUR sem `amountInAccountCurrency` não pode virar Fato: o
 * `amount` ainda é a moeda original. A Pluggy costuma mandar a conversão depois
 * em `transactions/updated`.
 */
export function transacao_tem_valor_na_moeda_da_conta(transacao: TransacaoPluggy): boolean {
  const naConta = transacao.amountInAccountCurrency;
  if (typeof naConta === "number" && Number.isFinite(naConta)) return true;
  const moeda = (transacao.currencyCode ?? MOEDA_DA_CONTA).trim().toUpperCase();
  return moeda === "" || moeda === MOEDA_DA_CONTA;
}

/**
 * Tradução de um lote: descarta internacional sem conversão, omite compra cujo
 * IOF denuncia valor ainda estrangeiro, incorpora IOF de compra (~3,5%) no
 * valor da compra e some o segundo "Pagamento recebido" da fatura.
 */
export function traduzir_lote_transacoes(transacoes: TransacaoPluggy[]): MovimentacaoExterna[] {
  const traduzidas: MovimentacaoExterna[] = [];
  for (const transacao of transacoes) {
    if (!transacao_tem_valor_na_moeda_da_conta(transacao)) continue;
    traduzidas.push(traduzir_transacao(transacao));
  }
  return absorver_creditos_de_fatura_duplicados(
    incorporar_iof_nas_compras(
      espaçar_parcelas_do_lote(omitir_compras_incompativeis_com_iof(traduzidas)),
    ),
  );
}

function chave_compra_parcela(movimentacao: MovimentacaoExterna): string | null {
  const parc = movimentacao.parcelamento;
  if (!parc?.compraEm || !parc.total || parc.numero < 1) return null;
  return `${movimentacao.contaExternaId}|${parc.total}`;
}

/** Na mesma compra, N+1 não fica no mês da N — mesmo se a Pluggy repetir `date`. */
function espaçar_parcelas_do_lote(movimentacoes: MovimentacaoExterna[]): MovimentacaoExterna[] {
  const porContaTotal = new Map<string, number[]>();
  movimentacoes.forEach((movimentacao, indice) => {
    const chave = chave_compra_parcela(movimentacao);
    if (!chave) return;
    const lista = porContaTotal.get(chave) ?? [];
    lista.push(indice);
    porContaTotal.set(chave, lista);
  });

  const saida = [...movimentacoes];
  for (const indices of porContaTotal.values()) {
    const clusters: number[][] = [];
    for (const indice of indices) {
      const atual = saida[indice]!;
      const cluster = clusters.find((grupo) => {
        const ancora = saida[grupo[0]!]!;
        const compraA = ancora.parcelamento?.compraEm;
        const compraB = atual.parcelamento?.compraEm;
        if (!compraA || !compraB) return false;
        return (
          datas_civis_proximas(compraA, compraB) &&
          descricoes_da_mesma_serie(ancora.descricaoFonte, atual.descricaoFonte)
        );
      });
      if (cluster) cluster.push(indice);
      else clusters.push([indice]);
    }

    for (const cluster of clusters) {
      const datas = garantir_parcelas_subsequentes(
        cluster.map((indice) => ({
          numero: saida[indice]!.parcelamento!.numero,
          dataMovimento: saida[indice]!.ocorridoEm,
        })),
      );
      for (const indice of cluster) {
        const numero = saida[indice]!.parcelamento!.numero;
        const data = datas.get(numero);
        if (!data || data === saida[indice]!.ocorridoEm) continue;
        saida[indice] = {
          ...saida[indice]!,
          ocorridoEm: data,
          ocorridoEmInstante: undefined,
        };
      }
    }
  }
  return saida;
}

function comercio_do_iof(descricao: string): string | null {
  const aspas = /^IOF de "(.+)"\s*$/i.exec(descricao.trim());
  if (aspas?.[1]?.trim()) return aspas[1].trim();
  const match = /^IOF INTERNACIONAL\s*-\s*(.+)$/i.exec(descricao.trim());
  const resto = match?.[1]?.trim();
  return resto ? resto : null;
}

function normalizar_descricao(descricao: string): string {
  return descricao.replace(/\s+/g, "").toLowerCase();
}

/** IOF da compra internacional — não o de atraso de fatura. */
export function eh_iof_compra_internacional(descricao: string): boolean {
  const texto = descricao.trim();
  if (!texto || /atraso/i.test(texto)) return false;
  if (/^IOF de compra internacional$/i.test(texto)) return true;
  if (/^IOF de "/i.test(texto)) return true;
  if (/^IOF INTERNACIONAL\s*-/i.test(texto)) return true;
  return false;
}

export function transacao_eh_iof_compra(transacao: TransacaoPluggy): boolean {
  const taxa = transacao.creditCardMetadata?.feeTypeAdditionalInfo;
  if (taxa === "IOF_COMPRA_INTERNACIONAL") return true;
  return eh_iof_compra_internacional(transacao.descriptionRaw ?? transacao.description ?? "");
}

/** IOF de cartão internacional é 3,5% do real. Folga cobre arredondamento da instituição. */
const IOF_SOBRE_COMPRA_MIN = 0.03;
const IOF_SOBRE_COMPRA_MAX = 0.04;
/** A Pluggy costuma postar o IOF no mesmo dia ou até 3 dias depois. */
const IOF_MAX_DIAS_DA_COMPRA = 5;

/**
 * O extrato do dia no app soma compra + IOF numa linha. A Pluggy manda os dois.
 * A alíquota ~3,5% só amarra o par (já em real, único na janela). O valor
 * somado é o IOF que a instituição lançou, não 3,5% recalculado. IOF de atraso,
 * compra ainda em moeda estrangeira e empate de duas compras ficam separados.
 */
export function incorporar_iof_nas_compras(
  movimentacoes: MovimentacaoExterna[],
): MovimentacaoExterna[] {
  const iofs: number[] = [];
  for (let indice = 0; indice < movimentacoes.length; indice++) {
    const item = movimentacoes[indice]!;
    if (item.tipo === "despesa" && eh_iof_compra_internacional(item.descricaoFonte)) {
      iofs.push(indice);
    }
  }
  if (iofs.length === 0) return movimentacoes;

  const compraUsada = new Set<number>();
  const par = new Map<number, number>();
  const acrescimo = new Map<number, number>();

  for (const iofIdx of iofs) {
    const iof = movimentacoes[iofIdx]!;
    const comercio = comercio_do_iof(iof.descricaoFonte);
    const candidatos: Array<{ idx: number; dias: number; desvio: number }> = [];

    for (let idx = 0; idx < movimentacoes.length; idx++) {
      if (idx === iofIdx || compraUsada.has(idx)) continue;
      const compra = movimentacoes[idx]!;
      if (compra.contaExternaId !== iof.contaExternaId) continue;
      if (compra.tipo !== "despesa" || compra.valor <= 0) continue;
      if (eh_iof_compra_internacional(compra.descricaoFonte)) continue;
      const ratio = iof.valor / compra.valor;
      if (ratio < IOF_SOBRE_COMPRA_MIN || ratio > IOF_SOBRE_COMPRA_MAX) continue;
      const dias = dias_calendario_entre(iof.ocorridoEm, compra.ocorridoEm);
      if (dias > IOF_MAX_DIAS_DA_COMPRA) continue;
      if (comercio && !descricoes_da_mesma_serie(comercio, compra.descricaoFonte)) continue;
      candidatos.push({ idx, dias, desvio: Math.abs(ratio - 0.035) });
    }

    candidatos.sort((a, b) => a.dias - b.dias || a.desvio - b.desvio);
    const melhor = candidatos[0];
    if (!melhor) continue;
    const empate = candidatos.filter(
      (item) => item.dias === melhor.dias && Math.abs(item.desvio - melhor.desvio) < 1e-9,
    );
    if (empate.length > 1) continue;

    compraUsada.add(melhor.idx);
    par.set(iofIdx, melhor.idx);
    acrescimo.set(melhor.idx, arredondar((acrescimo.get(melhor.idx) ?? 0) + iof.valor));
  }

  if (par.size === 0) return movimentacoes;

  return movimentacoes.map((item, indice) => {
    if (par.has(indice)) return { ...item, statusFonte: "removido" };
    const extra = acrescimo.get(indice);
    if (extra) return { ...item, valor: arredondar(item.valor + extra) };
    return item;
  });
}

/**
 * Nubank/Open Finance emite o pagamento da fatura duas vezes no cartão: um
 * CREDIT pendente (hora real) e outro POSTED na fatura fechada (meia-noite).
 * Ficam as duas linhas no extrato. Quando o par é único no lote, some a cópia.
 */
export function absorver_creditos_de_fatura_duplicados(
  movimentacoes: MovimentacaoExterna[],
): MovimentacaoExterna[] {
  const indices: number[] = [];
  for (let indice = 0; indice < movimentacoes.length; indice++) {
    const item = movimentacoes[indice]!;
    if (item.tipo === "receita" && eh_credito_quitacao_no_cartao(item.descricaoFonte)) {
      indices.push(indice);
    }
  }
  if (indices.length < 2) return movimentacoes;

  const usado = new Set<number>();
  const remover = new Set<number>();

  for (const i of indices) {
    if (usado.has(i)) continue;
    const ancora = movimentacoes[i]!;
    const cluster = [i];
    for (const j of indices) {
      if (j === i || usado.has(j)) continue;
      const outro = movimentacoes[j]!;
      if (outro.contaExternaId !== ancora.contaExternaId) continue;
      if (outro.valor !== ancora.valor) continue;
      if (dias_calendario_entre(ancora.ocorridoEm, outro.ocorridoEm) > 1) continue;
      cluster.push(j);
    }
    if (cluster.length < 2) continue;
    cluster.sort(
      (a, b) =>
        preferencia_credito_quitacao(movimentacoes[b]!) - preferencia_credito_quitacao(movimentacoes[a]!),
    );
    const vencedor = cluster[0]!;
    for (const indice of cluster) {
      usado.add(indice);
      if (indice !== vencedor) remover.add(indice);
    }
  }

  if (remover.size === 0) return movimentacoes;
  return movimentacoes.map((item, indice) =>
    remover.has(indice) ? { ...item, statusFonte: "removido" } : item,
  );
}

function preferencia_credito_quitacao(item: MovimentacaoExterna): number {
  return item.statusFonte === "confirmado" ? 1 : 0;
}

/**
 * Rede de segurança quando a Pluggy omite `currencyCode`. IOF fica; a compra
 * incompatível espera a conversão. Proporção ~3,5% mantém os dois.
 */
export function omitir_compras_incompativeis_com_iof(
  movimentacoes: MovimentacaoExterna[],
): MovimentacaoExterna[] {
  const rejeitar = new Set<string>();

  for (const iof of movimentacoes) {
    const comercio = comercio_do_iof(iof.descricaoFonte);
    if (!comercio || iof.valor <= 0) continue;
    const comercioN = normalizar_descricao(comercio);

    for (const compra of movimentacoes) {
      if (compra.idExterno === iof.idExterno) continue;
      if (compra.contaExternaId !== iof.contaExternaId) continue;
      if (compra.ocorridoEm !== iof.ocorridoEm) continue;
      if (comercio_do_iof(compra.descricaoFonte)) continue;
      if (normalizar_descricao(compra.descricaoFonte) !== comercioN) continue;
      if (compra.valor <= 0) continue;
      if (iof.valor / compra.valor > LIMIAR_IOF_SOBRE_VALOR_ESTRANGEIRO) {
        rejeitar.add(compra.idExterno);
      }
    }
  }

  return movimentacoes.filter((movimentacao) => !rejeitar.has(movimentacao.idExterno));
}

/**
 * Guarda a hora da Pluggy quando o dia do Fato é o UTC, o Brasil ou o relógio
 * da instituição (UTC−6). Parcela cuja competência foi deslocada para o mês da
 * fatura não herda o relógio da compra.
 */
export function instante_do_movimento(dateIso: string, diaMovimento: string): string | undefined {
  if (!dateIso.includes("T")) return undefined;
  const parsed = new Date(dateIso);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const diaUtc = dia_provedor_iso(dateIso);
  const diaBrasil = dia_civil_iso(dateIso);
  const diaInstituicao = dia_movimento_avulsa(dateIso);
  if (diaUtc !== diaMovimento && diaBrasil !== diaMovimento && diaInstituicao !== diaMovimento) {
    return undefined;
  }
  return parsed.toISOString();
}

/** Soma meses calendário preservando o dia (ajusta 31→último dia do mês destino). */
export const somar_meses = somar_meses_calendario;

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
    compraEm: metadados?.purchaseDate ? dia_provedor_iso(metadados.purchaseDate) : undefined,
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
