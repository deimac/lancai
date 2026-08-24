/**
 * Enxuga `descricao` (Conhecimento) nos Fatos de open_finance em que ela ainda
 * é cópia de `descricao_fonte`. O Fato não é alterado.
 *
 * Uso (raiz, com .env):
 *   pnpm --filter @lancai/api exec tsx src/scripts/backfill-descricao-enxuta.ts
 */
import "../ambiente";
import { and, eq } from "drizzle-orm";
import { movimento, obter_banco } from "@lancai/banco";
import { enxugar_descricao_fonte } from "@lancai/tipos";

const banco = obter_banco();

const candidatos = await banco
  .select({
    id: movimento.id,
    descricao: movimento.descricao,
    descricaoFonte: movimento.descricaoFonte,
  })
  .from(movimento)
  .where(and(eq(movimento.fonte, "open_finance"), eq(movimento.descricao, movimento.descricaoFonte)));

const atualizacoes = candidatos
  .map((linha) => ({
    id: linha.id,
    de: linha.descricao,
    para: enxugar_descricao_fonte(linha.descricaoFonte),
  }))
  .filter((item) => item.para !== item.de);

console.log("candidatos iguais à fonte", candidatos.length);
console.log("a enxugar", atualizacoes.length);
for (const item of atualizacoes.slice(0, 8)) {
  console.log("  ", JSON.stringify(item.de), "→", JSON.stringify(item.para));
}

for (const item of atualizacoes) {
  await banco
    .update(movimento)
    .set({ descricao: item.para, dataAtualizacao: new Date() })
    .where(eq(movimento.id, item.id));
}

console.log("backfill descricao enxuta ok");
process.exit(0);
