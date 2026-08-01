import { and, eq } from "drizzle-orm";
import { memoria as memoriaTabela, obter_banco } from "@lancai/banco";
import type { HabitoMemoria, RepositorioMemoria } from "./repositorio";

export class RepositorioMemoriaDrizzle implements RepositorioMemoria {
  private get banco() {
    return obter_banco();
  }

  async listarHabitos(usuarioId: string): Promise<HabitoMemoria[]> {
    const linhas = await this.banco
      .select({ chave: memoriaTabela.chave, valor: memoriaTabela.valor })
      .from(memoriaTabela)
      .where(eq(memoriaTabela.usuarioId, usuarioId));
    return linhas;
  }

  async buscarHabito(usuarioId: string, chave: string): Promise<string | undefined> {
    const linhas = await this.banco
      .select({ valor: memoriaTabela.valor })
      .from(memoriaTabela)
      .where(and(eq(memoriaTabela.usuarioId, usuarioId), eq(memoriaTabela.chave, chave)))
      .limit(1);
    return linhas[0]?.valor;
  }

  async salvarHabito(usuarioId: string, chave: string, valor: string): Promise<void> {
    const existente = await this.banco
      .select({ id: memoriaTabela.id })
      .from(memoriaTabela)
      .where(and(eq(memoriaTabela.usuarioId, usuarioId), eq(memoriaTabela.chave, chave)))
      .limit(1);

    if (existente[0]) {
      await this.banco
        .update(memoriaTabela)
        .set({ valor, dataAtualizacao: new Date() })
        .where(eq(memoriaTabela.id, existente[0].id));
      return;
    }

    await this.banco.insert(memoriaTabela).values({ usuarioId, chave, valor });
  }
}
