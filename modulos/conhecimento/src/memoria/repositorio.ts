export interface HabitoMemoria {
  chave: string;
  valor: string;
}

/**
 * Porta de persistência dos hábitos/preferências aprendidos do usuário
 * (ex.: "Nubank é meu cartão principal"). Pertence ao Conhecimento — nunca
 * ao contexto volátil de um provedor de IA (ADR-005).
 */
export interface RepositorioMemoria {
  listarHabitos(usuarioId: string): Promise<HabitoMemoria[]>;
  buscarHabito(usuarioId: string, chave: string): Promise<string | undefined>;
  salvarHabito(usuarioId: string, chave: string, valor: string): Promise<void>;
}
