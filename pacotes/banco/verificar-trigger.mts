/**
 * Verificação das invariantes do trigger de imutabilidade do Fato Financeiro.
 * Roda dentro de uma transação que sempre termina em ROLLBACK: nada que este
 * script cria sobrevive. Uso: pnpm --filter @lancai/banco verificar:trigger
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const urlBanco = process.env.DATABASE_URL;
if (!urlBanco) throw new Error("DATABASE_URL não configurada.");

const sql = postgres(urlBanco, { max: 1, prepare: false });

const resultados: Array<{ nome: string; ok: boolean; detalhe: string }> = [];

function registrar(nome: string, ok: boolean, detalhe = "") {
  resultados.push({ nome, ok, detalhe });
}

/**
 * Um erro em Postgres invalida a transação inteira, e boa parte das asserções
 * aqui espera erro. Cada uma roda dentro do seu savepoint para que a recusa
 * esperada não derrube as verificações seguintes.
 */
async function esperar_recusa(
  nome: string,
  acao: () => Promise<unknown>,
  trechoEsperado: string,
  emSavepoint: (cb: () => Promise<unknown>) => Promise<unknown>,
) {
  try {
    await emSavepoint(acao);
    registrar(nome, false, "a operação passou, mas devia ter sido recusada");
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    registrar(nome, mensagem.includes(trechoEsperado), mensagem.split("\n")[0] ?? "");
  }
}

async function esperar_sucesso(nome: string, acao: () => Promise<unknown>) {
  try {
    await acao();
    registrar(nome, true);
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    registrar(nome, false, mensagem.split("\n")[0] ?? "");
  }
}

class Rollback extends Error {}

try {
  await sql.begin(async (tx) => {
    const usuarioId = randomUUID();
    const workspaceId = randomUUID();
    const categoriaId = randomUUID();

    await tx`insert into usuario (id, email, nome) values (${usuarioId}, ${`trigger-${usuarioId}@teste.local`}, 'Verificação de trigger')`;
    await tx`insert into workspace (id, nome) values (${workspaceId}, 'Verificação')`;
    await tx`insert into workspace_membro (workspace_id, usuario_id, papel) values (${workspaceId}, ${usuarioId}, 'dono')`;
    await tx`insert into categoria (id, nome, tipo, usuario_id, workspace_id) values (${categoriaId}, 'Verificação', 'despesa', ${usuarioId}, ${workspaceId})`;

    async function inserir(fonte: "open_finance" | "manual", idExterno: string | null) {
      const id = randomUUID();
      await tx`
        insert into movimento (
          id, workspace_id, fonte, provedor, id_externo, valor, tipo, status,
          data_movimento, descricao_fonte, status_fonte, descricao, categoria_id,
          perfil, usuario_id, criado_por
        ) values (
          ${id}, ${workspaceId}, ${fonte}, ${fonte === "open_finance" ? "provedor_teste" : null},
          ${idExterno}, '185.00', 'despesa', 'realizado', '2026-08-01',
          'PAG*POSTO IPIRANGA 4471', 'confirmado', 'PAG*POSTO IPIRANGA 4471',
          ${categoriaId}, 'pf', ${usuarioId}, ${usuarioId}
        )`;
      return id;
    }

    const emSavepoint = (cb: () => Promise<unknown>) => tx.savepoint(() => cb());

    const doBanco = await inserir("open_finance", `tx-${randomUUID()}`);
    const manual = await inserir("manual", null);

    // --- Fato de conta sincronizada: recusa ---
    await esperar_recusa(
      "recusa alteração de valor em movimento de open_finance",
      () => tx`update movimento set valor = '999.00' where id = ${doBanco}`,
      "Fato Financeiro",
      emSavepoint,
    );
    await esperar_recusa(
      "recusa alteração de data_movimento em movimento de open_finance",
      () => tx`update movimento set data_movimento = '2026-01-01' where id = ${doBanco}`,
      "Fato Financeiro",
      emSavepoint,
    );
    await esperar_recusa(
      "recusa alteração de descricao_fonte em movimento de open_finance",
      () => tx`update movimento set descricao_fonte = 'reescrito' where id = ${doBanco}`,
      "Fato Financeiro",
      emSavepoint,
    );
    /**
     * O parcelamento é Fato: é a instituição dizendo "esta é a 3 de 10". Coluna
     * de Fato esquecida na lista do trigger fica silenciosamente editável, e
     * este caso existe para que esquecer não passe despercebido.
     */
    await esperar_recusa(
      "recusa alteração de parcela_total em movimento de open_finance",
      () => tx`update movimento set parcela_total = 12 where id = ${doBanco}`,
      "Fato Financeiro",
      emSavepoint,
    );
    await esperar_recusa(
      "recusa alteração de parcela_compra_valor em movimento de open_finance",
      () => tx`update movimento set parcela_compra_valor = '99.00' where id = ${doBanco}`,
      "Fato Financeiro",
      emSavepoint,
    );
    await esperar_recusa(
      "recusa exclusão de movimento de open_finance",
      () => tx`delete from movimento where id = ${doBanco}`,
      "Fato Financeiro",
      emSavepoint,
    );

    // --- Conhecimento sobre o mesmo movimento: permitido ---
    await esperar_sucesso(
      "permite editar descricao (Conhecimento) em movimento de open_finance",
      () => tx`update movimento set descricao = 'Gasolina do carro' where id = ${doBanco}`,
    );
    await esperar_sucesso(
      "permite marcar ignorado_em_relatorio em movimento de open_finance",
      () => tx`update movimento set ignorado_em_relatorio = true where id = ${doBanco}`,
    );
    await esperar_sucesso(
      "permite editar tags e observacoes em movimento de open_finance",
      () => tx`update movimento set tags = array['carro'], observacoes = 'viagem' where id = ${doBanco}`,
    );

    const [depois] = await tx`select descricao, descricao_fonte, valor from movimento where id = ${doBanco}`;
    registrar(
      "descricao_fonte preservada após renomear a descricao",
      depois?.descricao === "Gasolina do carro" &&
        depois?.descricao_fonte === "PAG*POSTO IPIRANGA 4471" &&
        depois?.valor === "185.00",
      JSON.stringify(depois),
    );

    // --- Movimento manual: Fato é editável ---
    await esperar_sucesso(
      "permite alterar valor em movimento manual",
      () => tx`update movimento set valor = '210.00' where id = ${manual}`,
    );
    await esperar_sucesso(
      "permite excluir movimento manual",
      () => tx`delete from movimento where id = ${manual}`,
    );

    // --- Escape hatch da sincronização ---
    await esperar_sucesso("escape hatch permite a sincronização atualizar o Fato", async () => {
      await tx`set local "lancai.sincronizacao" = 'on'`;
      await tx`update movimento set status_fonte = 'confirmado', valor = '190.00' where id = ${doBanco}`;
      await tx`set local "lancai.sincronizacao" = 'off'`;
    });

    await esperar_recusa(
      "trigger volta a proteger depois do escape hatch",
      () => tx`update movimento set valor = '777.00' where id = ${doBanco}`,
      "Fato Financeiro",
      emSavepoint,
    );

    // --- Índice de deduplicação ---
    const idExternoRepetido = `tx-${randomUUID()}`;
    await inserir("open_finance", idExternoRepetido);
    await esperar_recusa(
      "índice único recusa o mesmo id_externo no mesmo workspace",
      () => inserir("open_finance", idExternoRepetido),
      "movimento_id_externo_unico",
      emSavepoint,
    );

    throw new Rollback();
  });
} catch (erro) {
  if (!(erro instanceof Rollback)) {
    console.error(erro);
    await sql.end();
    process.exit(1);
  }
}

await sql.end();

const falhas = resultados.filter((r) => !r.ok);
for (const { nome, ok, detalhe } of resultados) {
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}${detalhe && !ok ? ` — ${detalhe}` : ""}`);
}
console.log(`\n${resultados.length - falhas.length}/${resultados.length} invariantes confirmadas.`);
process.exit(falhas.length === 0 ? 0 : 1);
