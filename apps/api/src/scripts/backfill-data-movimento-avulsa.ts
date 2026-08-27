/**
 * Avulsas OF: `data_movimento` = dia civil Brasil quando o instante tem hora
 * real (UTC ≥ 01:00). Cancela projeção de recorrência que casa com o Fato
 * (1 centavo).
 *
 * Uso (raiz, com .env):
 *   pnpm --filter @lancai/api exec tsx src/scripts/backfill-data-movimento-avulsa.ts
 */
import "../ambiente";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { movimento, obter_banco } from "@lancai/banco";
import { MotorFinanceiro, RepositorioFinanceiroDrizzle } from "@lancai/financeiro";
import { dia_civil_iso, dia_movimento_avulsa } from "@lancai/tipos";
import { escolher_pares_conciliacao } from "../servicos/conciliar-manual-com-fonte";

const banco = obter_banco();
const motor = new MotorFinanceiro(new RepositorioFinanceiroDrizzle());

const avulsas = await banco
  .select({
    id: movimento.id,
    dataMovimento: movimento.dataMovimento,
    ocorridoEmInstante: movimento.ocorridoEmInstante,
  })
  .from(movimento)
  .where(
    and(
      eq(movimento.fonte, "open_finance"),
      ne(movimento.status, "cancelado"),
      isNull(movimento.parcelaNumero),
    ),
  );

const correcoes = avulsas.flatMap((linha) => {
  if (!linha.ocorridoEmInstante) return [];
  const iso = linha.ocorridoEmInstante.toISOString();
  const proximo = dia_movimento_avulsa(iso);
  const atual = String(linha.dataMovimento).slice(0, 10);
  if (proximo === atual) return [];
  return [{ id: linha.id, de: atual, para: proximo, brasil: dia_civil_iso(iso) }];
});

console.log("datas avulsas a atualizar", correcoes.length);
for (const item of correcoes.slice(0, 8)) {
  console.log("  data", item.de, "→", item.para, item.brasil);
}

await banco.transaction(async (tx) => {
  await tx.execute(sql`SET LOCAL "lancai.sincronizacao" = 'on'`);
  for (const item of correcoes) {
    await tx
      .update(movimento)
      .set({ dataMovimento: item.para, dataAtualizacao: new Date() })
      .where(eq(movimento.id, item.id));
  }
});

const fatos = await banco
  .select()
  .from(movimento)
  .where(and(eq(movimento.fonte, "open_finance"), ne(movimento.status, "cancelado")));
const gerados = await banco
  .select()
  .from(movimento)
  .where(and(eq(movimento.fonte, "recorrencia"), ne(movimento.status, "cancelado")));

const pares = escolher_pares_conciliacao(fatos, gerados, 7);
console.log("pares recorrência↔OF", pares.length);

let cancelados = 0;
for (const par of pares) {
  const gerado = gerados.find((item) => item.id === par.manualId);
  const fato = fatos.find((item) => item.id === par.fatoId);
  if (!gerado || !fato) continue;
  await motor.cancelar_para_conciliacao({
    manualId: gerado.id,
    fatoId: fato.id,
    alteradoPor: gerado.usuarioId,
  });
  cancelados += 1;
  console.log("  cancelou", gerado.descricao, gerado.valor, "→", fato.valor);
}
console.log("recorrências canceladas", cancelados);

process.exit(0);
