/**
 * Reset financeiro de UM usuário de teste (Meu Pluggy / Open Finance).
 *
 * Apaga: movimentos, parcelas, conexões OF, contas, cartões.
 * Zera vínculos em orçamento/recorrência.
 * Mantém: usuario, workspace, categorias, regras, login.
 *
 * Uso (raiz do monorepo, com DATABASE_URL):
 *   USUARIO_ID=<uuid> CONFIRMAR=1 pnpm --filter @lancai/banco db:reset-financeiro
 */
import postgres from "postgres";

async function main() {
  const usuarioId = process.env.USUARIO_ID?.trim();
  const confirmar = process.env.CONFIRMAR?.trim() === "1";
  const url = process.env.DATABASE_URL?.trim();

  if (!url) {
    console.error("DATABASE_URL é obrigatória.");
    process.exit(1);
  }
  if (!usuarioId || !/^[0-9a-f-]{36}$/i.test(usuarioId)) {
    console.error("USUARIO_ID deve ser um UUID válido.");
    process.exit(1);
  }
  if (!confirmar) {
    console.error(
      "Dry-run: defina CONFIRMAR=1 para executar.\n" +
        `Alvo: usuario_id=${usuarioId}`,
    );
    process.exit(2);
  }

  const sql = postgres(url, { max: 1, prepare: false });

  try {
    const [usuario] = await sql<{ id: string; email: string | null; nome: string | null }[]>`
      select id, email, nome from usuario where id = ${usuarioId}::uuid
    `;
    if (!usuario) {
      console.error(`Usuário ${usuarioId} não encontrado.`);
      process.exit(1);
    }

    console.log(`Reset financeiro de ${usuario.nome ?? "?"} <${usuario.email ?? "?"}> (${usuario.id})`);

    await sql.begin(async (tx) => {
      const parcelas = await tx`
        delete from parcela
        where movimento_id in (select id from movimento where usuario_id = ${usuarioId}::uuid)
      `;
      console.log(`parcelas: ${parcelas.count}`);

      const movimentos = await tx`
        delete from movimento where usuario_id = ${usuarioId}::uuid
      `;
      console.log(`movimentos: ${movimentos.count}`);

      // orcamento no schema atual não referencia conta/cartão — nada a desvincular.

      const recorrencias = await tx`
        update recorrencia
        set conta_id = null, cartao_id = null, data_atualizacao = now()
        where usuario_id = ${usuarioId}::uuid
          and (conta_id is not null or cartao_id is not null)
      `;
      console.log(`recorrencias desvinculadas: ${recorrencias.count}`);

      const contasExternas = await tx`
        delete from open_finance_conta_externa
        where conexao_id in (
          select id from open_finance_conexao where criado_por = ${usuarioId}::uuid
        )
      `;
      console.log(`open_finance_conta_externa: ${contasExternas.count}`);

      const conexoes = await tx`
        delete from open_finance_conexao where criado_por = ${usuarioId}::uuid
      `;
      console.log(`open_finance_conexao: ${conexoes.count}`);

      // cartao.conta_id → conta; limpar antes de apagar contas
      await tx`
        update cartao set conta_id = null, data_atualizacao = now()
        where usuario_id = ${usuarioId}::uuid and conta_id is not null
      `;

      const cartoes = await tx`
        delete from cartao where usuario_id = ${usuarioId}::uuid
      `;
      console.log(`cartoes: ${cartoes.count}`);

      const contas = await tx`
        delete from conta where usuario_id = ${usuarioId}::uuid
      `;
      console.log(`contas: ${contas.count}`);
    });

    console.log("OK — usuário pronto para registrar itemId do Meu Pluggy.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
