import type { HabitoMemoria, RepositorioMemoria } from "./repositorio";

/** Implementação em memória, usada exclusivamente em testes unitários. */
export class RepositorioMemoriaEmMemoria implements RepositorioMemoria {
  readonly habitos = new Map<string, string>();

  private chaveInterna(usuarioId: string, chave: string): string {
    return `${usuarioId}::${chave}`;
  }

  async listarHabitos(usuarioId: string): Promise<HabitoMemoria[]> {
    const prefixo = `${usuarioId}::`;
    const resultado: HabitoMemoria[] = [];
    for (const [chaveInterna, valor] of this.habitos.entries()) {
      if (chaveInterna.startsWith(prefixo)) {
        resultado.push({ chave: chaveInterna.slice(prefixo.length), valor });
      }
    }
    return resultado;
  }

  async buscarHabito(usuarioId: string, chave: string): Promise<string | undefined> {
    return this.habitos.get(this.chaveInterna(usuarioId, chave));
  }

  async salvarHabito(usuarioId: string, chave: string, valor: string): Promise<void> {
    this.habitos.set(this.chaveInterna(usuarioId, chave), valor);
  }
}
