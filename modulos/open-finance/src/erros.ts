export class ErroOpenFinance extends Error {}

/** O corpo do webhook não tem a forma que o adaptador espera. */
export class ErroWebhookInvalido extends ErroOpenFinance {
  constructor(motivo: string) {
    super(`webhook não reconhecido: ${motivo}`);
    this.name = "ErroWebhookInvalido";
  }
}

/**
 * O provedor não respondeu como devia. Fica separada de erro de validação porque
 * o tratamento é outro: aqui vale tentar de novo mais tarde, e é isso que o
 * reprocesso de `open_finance_evento` faz.
 */
export class ErroProvedorIndisponivel extends ErroOpenFinance {
  constructor(detalhe: string) {
    super(`provedor indisponível: ${detalhe}`);
    this.name = "ErroProvedorIndisponivel";
  }
}

export class ErroConexaoNaoEncontrada extends ErroOpenFinance {
  constructor(id: string) {
    super(`conexão não encontrada: ${id}`);
    this.name = "ErroConexaoNaoEncontrada";
  }
}

export class ErroContaExternaNaoEncontrada extends ErroOpenFinance {
  constructor(id: string) {
    super(`conta externa não encontrada nesta conexão: ${id}`);
    this.name = "ErroContaExternaNaoEncontrada";
  }
}

export class ErroAssociacaoInvalida extends ErroOpenFinance {
  constructor(motivo: string) {
    super(motivo);
    this.name = "ErroAssociacaoInvalida";
  }
}

/**
 * A paginação não terminou dentro do limite. Provedor devolvendo cursor em ciclo
 * é bug do provedor, mas sem este freio ele viraria laço infinito aqui.
 */
export class ErroLoteInterminavel extends ErroOpenFinance {
  constructor(limite: number) {
    super(`lote passou de ${limite} páginas sem terminar; paginação interrompida`);
    this.name = "ErroLoteInterminavel";
  }
}