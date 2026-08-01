import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Carrega o `.env` da raiz do monorepo, independente de onde a API for iniciada. */
config({ path: path.resolve(__dirname, "../../../.env") });
