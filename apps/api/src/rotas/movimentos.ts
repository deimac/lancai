import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import { movimento, obter_banco } from "@lancai/banco";
import { schemaCriarMovimento } from "@lancai/tipos";
import { MotorFinanceiro, RepositorioFinanceiroDrizzle } from "@lancai/financeiro";

const motor = new MotorFinanceiro(new RepositorioFinanceiroDrizzle());

export async function registrar_rotas_movimento(app: FastifyInstance) {
  app.post("/", async (requisicao, resposta) => {
    const dados = schemaCriarMovimento.parse(requisicao.body);
    const resultado = await motor.criar_movimento(dados);
    return resposta.status(201).send(resultado);
  });

  app.get("/", async (requisicao) => {
    const { usuarioId } = requisicao.query as { usuarioId?: string };
    const banco = obter_banco();
    const consulta = banco.select().from(movimento).orderBy(desc(movimento.dataMovimento));
    if (usuarioId) {
      return consulta.where(eq(movimento.usuarioId, usuarioId));
    }
    return consulta;
  });
}
