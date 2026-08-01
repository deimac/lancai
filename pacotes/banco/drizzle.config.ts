import { defineConfig } from "drizzle-kit";

const urlBanco = process.env.DATABASE_URL;

if (!urlBanco) {
  throw new Error("DATABASE_URL não configurada. Copie .env.example para .env na raiz do projeto.");
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: urlBanco,
  },
  verbose: true,
  strict: true,
});
