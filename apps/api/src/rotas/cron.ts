import type { FastifyInstance } from "fastify";
import { MotorFinanceiro, RepositorioFinanceiroDrizzle } from "@lancai/financeiro";
import { gerar_recorrencias_do_dia } from "../servicos/recorrencia-servico";

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

export async function registrar_rotas_cron(app: FastifyInstance) {
  app.post("/recorrencias", async (requisicao, resposta) => {
    if (!autorizar_cron(requisicao)) {
      return resposta.status(401).send({ erro: "Não autorizado." });
    }
    const resultado = await gerar_recorrencias_do_dia(motor);
    requisicao.log.info(resultado, "[cron] recorrências processadas");
    return { ok: true, ...resultado };
  });
}
