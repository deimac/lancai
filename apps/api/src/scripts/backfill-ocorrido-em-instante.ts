/**
 * Recoleta o extrato já materializado na Pluggy (GET, 365 dias) e atualiza
 * `ocorrido_em_instante` nos Fatos existentes.
 *
 * Uso (raiz, com .env):
 *   pnpm --filter @lancai/api exec tsx src/scripts/backfill-ocorrido-em-instante.ts
 */
import "../ambiente";
import type { FastifyBaseLogger } from "fastify";
import { importar_historico_conexoes_open_finance } from "../servicos/importar-historico-open-finance";

const log = {
  info(obj: unknown, msg?: string) {
    console.log(msg ?? "", typeof obj === "object" ? JSON.stringify(obj) : obj);
  },
  warn(obj: unknown, msg?: string) {
    console.warn(msg ?? "", obj);
  },
  error(obj: unknown, msg?: string) {
    console.error(msg ?? "", obj);
  },
} as FastifyBaseLogger;

const resultado = await importar_historico_conexoes_open_finance({
  log,
  staleAposMinutos: 0,
  lookbackDias: 365,
  limite: 20,
});

console.log("backfill ocorrido_em_instante", resultado);
if (resultado.falhas > 0 || !resultado.fonteAtiva) {
  process.exit(1);
}
