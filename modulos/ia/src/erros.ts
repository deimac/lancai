/** Nenhum provedor configurado conseguiu gerar um objeto estruturado válido. */
export class ErroTodosProvedoresFalharam extends Error {
  constructor(public readonly detalhes: Array<{ provedor: string; erro: unknown }>) {
    super(
      `Todos os provedores de IA disponíveis falharam: ${detalhes.map((detalhe) => detalhe.provedor).join(", ") || "nenhum provedor configurado"}`,
    );
    this.name = "ErroTodosProvedoresFalharam";
  }
}

/**
 * A IA citou o nome de uma conta/cartão/categoria/pessoa/movimento que o
 * `ResolvedorIntencao` não conseguiu encontrar no banco do usuário.
 */
export class ErroReferenciaNaoEncontrada extends Error {
  constructor(
    public readonly tipoReferencia: string,
    public readonly nomeBuscado: string,
  ) {
    super(`Não encontrei "${nomeBuscado}" (${tipoReferencia}). Pode confirmar o nome exato?`);
    this.name = "ErroReferenciaNaoEncontrada";
  }
}

/**
 * Rede de segurança contra duplicação acidental: a IA tentou CRIAR_CONTA/CRIAR_CARTAO com um
 * nome que já existe para o usuário. Sem essa checagem, uma mensagem ambígua (ex.: um pedido de
 * correção de saldo que a IA não soube classificar) poderia virar silenciosamente uma conta/
 * cartão duplicado em vez de atualizar o que já existe — o caminho certo nesse caso é
 * CORRIGIR_CONTA/CORRIGIR_CARTAO.
 */
export class ErroEntidadeJaExiste extends Error {
  constructor(
    public readonly tipoEntidade: "conta" | "cartão",
    public readonly nome: string,
  ) {
    super(
      `Você já tem ${tipoEntidade === "conta" ? "uma conta" : "um cartão"} chamado "${nome}". Se quiser mudar o saldo, nome ou outro dado, é só me dizer o que alterar.`,
    );
    this.name = "ErroEntidadeJaExiste";
  }
}

/**
 * A IA devolveu CRIAR_CONTA/CRIAR_CARTAO já "completa" (sem passar por
 * SOLICITAR_INFORMACAO), mas algum campo obrigatório ainda veio vazio — não
 * deveria acontecer no fluxo normal (é o prompt que instrui a usar
 * SOLICITAR_INFORMACAO quando falta dado), mas serve de rede de segurança.
 */
export class ErroDadosIncompletos extends Error {
  constructor(
    public readonly intencao: string,
    public readonly campoFaltante: string,
  ) {
    super(`Para ${intencao.toLowerCase()}, ainda preciso saber: ${campoFaltante}.`);
    this.name = "ErroDadosIncompletos";
  }
}
