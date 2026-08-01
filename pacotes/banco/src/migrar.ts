import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

async function migrar() {
  const urlBanco = process.env.DATABASE_URL;
  if (!urlBanco) {
    throw new Error("DATABASE_URL não configurada.");
  }

  const conexao = postgres(urlBanco, { max: 1, prepare: false });
  const banco = drizzle(conexao);

  console.log("Aplicando migrations em", urlBanco.replace(/:[^:@]*@/, ":****@"));
  await migrate(banco, { migrationsFolder: "./drizzle" });
  console.log("Migrations aplicadas com sucesso.");

  await conexao.end();
}

migrar().catch((erro) => {
  console.error("Falha ao aplicar migrations:", erro);
  process.exit(1);
});
