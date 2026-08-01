export class ErroFinanceiro extends Error {}

export class ErroRecursoNaoEncontrado extends ErroFinanceiro {
  constructor(recurso: string, id: string) {
    super(`${recurso} não encontrado(a): ${id}`);
    this.name = "ErroRecursoNaoEncontrado";
  }
}

export class ErroValidacaoFinanceira extends ErroFinanceiro {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroValidacaoFinanceira";
  }
}

export class ErroLimiteCartaoExcedido extends ErroFinanceiro {
  constructor(cartaoNome: string, disponivel: number, solicitado: number) {
    super(
      `Limite do cartão "${cartaoNome}" excedido: disponível R$ ${disponivel.toFixed(2)}, solicitado R$ ${solicitado.toFixed(2)}.`,
    );
    this.name = "ErroLimiteCartaoExcedido";
  }
}

export class ErroTipoMovimentoNaoImplementado extends ErroFinanceiro {
  constructor(tipo: string) {
    super(`Tipo de movimento "${tipo}" ainda não implementado no MotorFinanceiro.`);
    this.name = "ErroTipoMovimentoNaoImplementado";
  }
}
