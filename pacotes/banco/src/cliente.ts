import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

let instanciaBanco: ReturnType<typeof drizzle<typeof schema>> | undefined;

/**
 * Retorna um client Drizzle singleton conectado ao Postgres do Supabase.
 * Usa `DATABASE_URL` do ambiente (nunca credenciais da IA).
 */
export function obter_banco() {
  if (instanciaBanco) return instanciaBanco;

  const urlBanco = process.env.DATABASE_URL;
  if (!urlBanco) {
    throw new Error("DATABASE_URL não configurada.");
  }

  // Pooler Supabase em session mode (porta 5432) tem teto baixo (~15).
  // postgres.js default max=10 esgota o pool com 1–2 processos + MCP/tools.
  const conexao = postgres(urlBanco, {
    prepare: false,
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  instanciaBanco = drizzle(conexao, { schema });
  return instanciaBanco;
}

export type Banco = ReturnType<typeof obter_banco>;
