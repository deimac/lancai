const PREFIXO = "[evolution]";

export const loggerEvolution = {
  info(mensagem: string, dados?: unknown): void {
    if (dados !== undefined) {
      console.info(PREFIXO, mensagem, dados);
      return;
    }
    console.info(PREFIXO, mensagem);
  },

  error(mensagem: string, dados?: unknown): void {
    if (dados !== undefined) {
      console.error(PREFIXO, mensagem, dados);
      return;
    }
    console.error(PREFIXO, mensagem);
  },
};
