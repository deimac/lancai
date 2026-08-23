import type { CommandResult } from "@lancai/tipos";

export interface IdempotencyStore {
  get(key: string): Promise<CommandResult | null>;
  set(key: string, value: CommandResult): Promise<void>;
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly itens = new Map<string, CommandResult>();

  async get(key: string): Promise<CommandResult | null> {
    return this.itens.get(key) ?? null;
  }

  async set(key: string, value: CommandResult): Promise<void> {
    this.itens.set(key, value);
  }
}
