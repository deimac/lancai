import type { FastifyInstance } from "fastify";
import { MotorFinanceiro, RepositorioFinanceiroDrizzle } from "@lancai/financeiro";
import { importar_historico_conexoes_open_finance } from "../servicos/importar-historico-open-finance";
import { gerar_recorrencias_do_dia } from "../servicos/recorrencia-servico";
import { reprocessar_eventos_open_finance } from "../servicos/reprocessar-open-finance";
import { aplicar_retencao_open_finance } from "../servicos/retencao-open-finance";
import { enviar_resumos_baixa_confianca } from "../servicos/resumo-baixa-confianca";

const motor = new MotorFinanceiro(new RepositorioFinanceiroDrizzle());

function autorizar_cron(requisicao: { headers: Record<string, string | string[] | undefined> }): boolean {
  const secreto = process.env.CRON_SECRET?.trim();
  if (!secreto) return false;
  const header = requisicao.headers.authorization;
  const valor = Array.isArray(header) ? header[0] : header;
  if (valor === `Bearer ${secreto}`) return true;
  const xCron = requisicao.headers["x-cron-secret"];
  const xValor = Array.isArray(xCron) ? xCron[0] : xCron;
  return xValor === secreto;
}

function limite_da_query(query: { limite?: string }): number {
  const n = Number(query.limite);
  if (!Number.isFinite(n) || n < 1) return 50;
  return Math.min(Math.floor(n), 200);
}

export async function registrar_rotas_cron(app: FastifyInstance) {
  app.post("/recorrencias", async (requisicao, resposta) => {
    if (!autorizar_cron(requisicao)) {
      return resposta.status(401).send({ erro: "Não autorizado." });
    }
    const resultado = await gerar_recorrencias_do_dia(motor);
    requisicao.log.info(resultado, "[cron] recorrências processadas");
    return { ok: true, ...resultado };
  });

  /**
   * Resumo diário WhatsApp: não classificado + IA abaixo do limiar.
   * Query `?dryRun=1` monta a fila sem enviar nem gravar hábito.
   */
  app.post("/resumo-baixa-confianca", async (requisicao, resposta) => {
    if (!autorizar_cron(requisicao)) {
      return resposta.status(401).send({ erro: "Não autorizado." });
    }
    const query = requisicao.query as { dryRun?: string };
    const dryRun = query.dryRun === "1" || query.dryRun === "true";
    const resultado = await enviar_resumos_baixa_confianca({ dryRun });
    requisicao.log.info(resultado, "[cron] resumo baixa confiança");
    return { ok: true, ...resultado };
  });

  /**
   * Rede de segurança Open Finance: reprocessa `open_finance_evento` com `erro`.
   * `?dryRun=1` só lista; `?limite=N` (máx. 200) corta o lote.
   */
  app.post("/open-finance-reprocessar", async (requisicao, resposta) => {
    if (!autorizar_cron(requisicao)) {
      return resposta.status(401).send({ erro: "Não autorizado." });
    }
    const query = requisicao.query as { dryRun?: string; limite?: string };
    const dryRun = query.dryRun === "1" || query.dryRun === "true";
    const resultado = await reprocessar_eventos_open_finance({
      log: requisicao.log,
      dryRun,
      limite: limite_da_query(query),
    });
    requisicao.log.info(resultado, "[cron] open-finance reprocessar");
    return { ok: true, ...resultado };
  });

  /**
   * Importa extrato via GET (já coletado no provedor). Não dispara PATCH/sync.
   * Cobre Meu Pluggy e webhooks silenciosos. Agendar a cada ~6 h.
   */
  app.post("/open-finance-importar-historico", async (requisicao, resposta) => {
    if (!autorizar_cron(requisicao)) {
      return resposta.status(401).send({ erro: "Não autorizado." });
    }
    const query = requisicao.query as { dryRun?: string; limite?: string };
    const dryRun = query.dryRun === "1" || query.dryRun === "true";
    const resultado = await importar_historico_conexoes_open_finance({
      log: requisicao.log,
      dryRun,
      limite: limite_da_query(query),
    });
    requisicao.log.info(resultado, "[cron] open-finance importar histórico");
    return { ok: true, ...resultado };
  });

  /**
   * LGPD: anonimiza payload bruto de eventos OF processados com sucesso há mais
   * de `OPEN_FINANCE_RETENCAO_DIAS` (padrão 30). A linha fica — idempotência.
   */
  app.post("/open-finance-retencao", async (requisicao, resposta) => {
    if (!autorizar_cron(requisicao)) {
      return resposta.status(401).send({ erro: "Não autorizado." });
    }
    const query = requisicao.query as { limite?: string };
    const limite = Number(query.limite);
    const resultado = await aplicar_retencao_open_finance({
      limite: Number.isFinite(limite) && limite > 0 ? Math.min(Math.floor(limite), 2000) : 500,
    });
    requisicao.log.info(resultado, "[cron] open-finance retenção");
    return { ok: true, ...resultado };
  });
}
