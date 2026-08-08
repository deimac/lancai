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

/**
 * Tentativa de alterar o Fato Financeiro de uma movimentação vinda de
 * instituição financeira. Não é um bug do chamador: é a invariante do ADR-009
 * funcionando, e a mensagem precisa explicar ao usuário o caminho que existe.
 */
export class ErroFatoImutavel extends ErroFinanceiro {
  constructor(descricao: string) {
    super(
      `"${descricao}" veio direto do banco, então valor, data e conta não podem ser alterados. ` +
        `Posso mudar categoria, descrição, tags e observações, ou marcar para não entrar nos relatórios.`,
    );
    this.name = "ErroFatoImutavel";
  }
}

/**
 * Tentativa de criar, corrigir ou cancelar Fato à mão em conta ou cartão
 * conectado ao Open Finance. A movimentação vai chegar pelo sync, e registrar
 * agora produziria duplicata — que é o pior resultado possível no primeiro dia
 * de uso do Open Finance.
 *
 * É o par de `ErroFatoImutavel`: aquele protege o Fato que já existe, este
 * protege a conta de ganhar um Fato que não deveria nascer aqui.
 */
export class ErroContaSincronizada extends ErroFinanceiro {
  constructor(
    readonly origem: string,
    readonly acao: "criar" | "corrigir" | "cancelar",
  ) {
    const oQueEuFaco =
      acao === "criar"
        ? "Quando cair no extrato, me chame que eu classifico."
        : "Posso mudar categoria, descrição, tags e observações, ou marcar para não entrar nos relatórios.";
    super(`"${origem}" está conectada ao banco, então o lançamento vem de lá. ${oQueEuFaco}`);
    this.name = "ErroContaSincronizada";
  }
}

export class ErroTipoMovimentoNaoImplementado extends ErroFinanceiro {
  constructor(tipo: string) {
    super(`Tipo de movimento "${tipo}" ainda não implementado no MotorFinanceiro.`);
    this.name = "ErroTipoMovimentoNaoImplementado";
  }
}
