import type { HabitoMemoria, RepositorioMemoria } from "./repositorio";

/**
 * Hábitos aprendidos do usuário (ex.: "Nubank é o cartão principal").
 * Consultada pelo `InterpretadorIntencoes` para reduzir perguntas; quem
 * persiste o aprendizado é sempre o Conhecimento — nunca a IA.
 *
 * Absorvida de `modulos/memoria` na F3 (ADR-014).
 */
export class Memoria {
  constructor(private readonly repositorio: RepositorioMemoria) {}

  async buscar_habitos(usuarioId: string): Promise<HabitoMemoria[]> {
    return this.repositorio.listarHabitos(usuarioId);
  }

  async buscar_habito(usuarioId: string, chave: string): Promise<string | undefined> {
    return this.repositorio.buscarHabito(usuarioId, chave);
  }

  async salvar_habito(usuarioId: string, chave: string, valor: string): Promise<void> {
    return this.repositorio.salvarHabito(usuarioId, chave, valor);
  }
}
