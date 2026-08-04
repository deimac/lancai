/** Erro padronizado das chamadas à Evolution API. */
export class ErroEvolution extends Error {
  constructor(
    public readonly metodo: string,
    message: string,
    public readonly status?: number,
    public readonly detalhes?: unknown,
  ) {
    super(message);
    this.name = "ErroEvolution";
  }
}
