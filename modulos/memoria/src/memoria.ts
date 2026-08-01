import type { HabitoMemoria, RepositorioMemoria } from "./repositorio";

/**
 * Conhecimento permanente e hábitos aprendidos do usuário (ex.: "Nubank é o
 * cartão principal", "Inter PJ é a conta da empresa"). É consultada pelo
 * `InterpretadorIntencoes` (modulos/ia) para reduzir perguntas ao usuário,
 * mas quem persiste o aprendizado é sempre este módulo — nunca a IA.
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
