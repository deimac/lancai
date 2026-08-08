export class ErroConhecimento extends Error {}

export class ErroMovimentoNaoEncontrado extends ErroConhecimento {
  constructor(id: string) {
    super(`movimento não encontrado: ${id}`);
    this.name = "ErroMovimentoNaoEncontrado";
  }
}

export class ErroConhecimentoInvalido extends ErroConhecimento {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroConhecimentoInvalido";
  }
}
