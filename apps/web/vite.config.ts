import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Lê o .env da raiz do monorepo (mesmo arquivo usado pelo apps/api), em vez
  // de exigir um apps/web/.env separado.
  envDir: fileURLToPath(new URL("../..", import.meta.url)),
  server: {
    host: true,
    port: 5173,
  },
});
