/**
 * Diagnóstico READ-ONLY de uma série de lançamentos (compra parcelada, estorno,
 * previsão de fatura) de um usuário — não altera nada no banco.
 *
 * Uso (raiz do monorepo, com DATABASE_URL):
 *   USUARIO_ID=<uuid> BUSCA="agencia" pnpm --filter @lancai/banco db:diagnosticar-fatura
 *   USUARIO_ID=<uuid> CARTAO_ID=<uuid> pnpm --filter @lancai/banco db:diagnosticar-fatura
 *
 * BUSCA filtra por `descricao_fonte ILIKE %BUSCA%` (case-insensitive).
 * CARTAO_ID filtra por cartão. Pelo menos um dos dois é obrigatório.
 *
 * Mostra, para cada movimento encontrado:
 *   tipo, valor, status, parcela (numero/total/compra_em/compra_valor),
 *   provider_bill_id, provider_bill_forecast_date, papel, ignorado_em_relatorio,
 *   descricao_fonte, data_movimento, id_externo — e, se existir, a alocação
 *   atual em bill_allocation e a fatura_oficial do cartão nas competências
 *   envolvidas.
 */
import postgres from "postgres";

async function main() {
  const usuarioId = process.env.USUARIO_ID?.trim();
  const busca = process.env.BUSCA?.trim();
  const cartaoId = process.env.CARTAO_ID?.trim();
  const url = process.env.DATABASE_URL?.trim();

  if (!url) {
    console.error("DATABASE_URL é obrigatória.");
    process.exit(1);
  }
  if (!usuarioId || !/^[0-9a-f-]{36}$/i.test(usuarioId)) {
    console.error("USUARIO_ID deve ser um UUID válido.");
    process.exit(1);
  }
  if (!busca && !cartaoId) {
    console.error("Informe BUSCA (trecho da descrição) e/ou CARTAO_ID.");
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, prepare: false });

  try {
    const movimentos = await sql<
      Array<{
        id: string;
        cartao_id: string | null;
        descricao_fonte: string;
        tipo: string;
        valor: string;
        status: string;
        status_fonte: string;
        papel: string;
        ignorado_em_relatorio: boolean;
        data_movimento: string;
        parcela_numero: number | null;
        parcela_total: number | null;
        parcela_compra_em: string | null;
        parcela_compra_valor: string | null;
        provider_bill_id: string | null;
        provider_bill_forecast_date: string | null;
        id_externo: string | null;
        data_criacao: string;
      }>
    >`
      select
        id, cartao_id, descricao_fonte, tipo, valor, status, status_fonte,
        papel, ignorado_em_relatorio, data_movimento,
        parcela_numero, parcela_total, parcela_compra_em, parcela_compra_valor,
        provider_bill_id, provider_bill_forecast_date, id_externo, data_criacao
      from movimento
      where usuario_id = ${usuarioId}::uuid
        ${cartaoId ? sql`and cartao_id = ${cartaoId}::uuid` : sql``}
        ${busca ? sql`and descricao_fonte ilike ${"%" + busca + "%"}` : sql``}
      order by data_movimento asc, data_criacao asc
    `;

    console.log(`\n=== ${movimentos.length} movimento(s) encontrado(s) ===\n`);
    for (const m of movimentos) {
      console.log(
        [
          `[${m.data_movimento}] ${m.tipo.padEnd(8)} R$ ${Number(m.valor).toFixed(2).padStart(10)}`,
          `status=${m.status}/${m.status_fonte}`,
          `papel=${m.papel}`,
          m.ignorado_em_relatorio ? "IGNORADO_EM_RELATORIO" : "",
          m.parcela_numero ? `parcela ${m.parcela_numero}/${m.parcela_total} (compra ${m.parcela_compra_em}, valor_compra ${m.parcela_compra_valor})` : "",
          m.provider_bill_id ? `providerBillId=${m.provider_bill_id}` : "",
          m.provider_bill_forecast_date ? `providerBillForecastDate=${m.provider_bill_forecast_date}` : "",
          `— "${m.descricao_fonte}"`,
          `(id=${m.id}, idExterno=${m.id_externo ?? "—"})`,
        ]
          .filter(Boolean)
          .join(" | "),
      );
    }

    if (movimentos.length === 0) {
      console.log("Nenhum movimento encontrado com esses filtros.");
      return;
    }

    const movimentoIds = movimentos.map((m) => m.id);
    const alocacoes = await sql<
      Array<{
        movimento_id: string;
        competencia: string | null;
        status: string;
        metodo: string;
        is_current: boolean;
        estado_conflito: string;
        fatura_oficial_id: string | null;
        valido_desde: string;
      }>
    >`
      select movimento_id, competencia, status, metodo, is_current, estado_conflito,
             fatura_oficial_id, valido_desde
      from bill_allocation
      where movimento_id in ${sql(movimentoIds)}
      order by movimento_id, valido_desde desc
    `;

    console.log(`\n=== ${alocacoes.length} linha(s) de bill_allocation ===\n`);
    for (const a of alocacoes) {
      console.log(
        `movimento=${a.movimento_id} | competencia=${a.competencia ?? "—"} | status=${a.status} | metodo=${a.metodo} | isCurrent=${a.is_current} | conflito=${a.estado_conflito}`,
      );
    }

    const cartaoIds = [...new Set(movimentos.map((m) => m.cartao_id).filter((v): v is string => Boolean(v)))];
    if (cartaoIds.length > 0) {
      const competencias = [
        ...new Set(
          movimentos.flatMap((m) => [
            m.data_movimento.slice(0, 7),
            ...(m.parcela_compra_em ? [m.parcela_compra_em.slice(0, 7)] : []),
            ...(m.provider_bill_forecast_date ? [m.provider_bill_forecast_date] : []),
          ]),
        ),
      ];
      const oficiais = await sql<
        Array<{ cartao_id: string; competencia: string; total: string; data_fechamento: string | null }>
      >`
        select cartao_id, competencia, total, data_fechamento
        from fatura_oficial
        where cartao_id in ${sql(cartaoIds)} and competencia in ${sql(competencias)}
        order by competencia
      `;
      console.log(`\n=== ${oficiais.length} fatura_oficial relevante(s) ===\n`);
      for (const o of oficiais) {
        console.log(`cartao=${o.cartao_id} | competencia=${o.competencia} | total=${o.total} | fechamento=${o.data_fechamento ?? "—"}`);
      }
    }

    console.log("\n(read-only — nada foi alterado)\n");
  } finally {
    await sql.end();
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
