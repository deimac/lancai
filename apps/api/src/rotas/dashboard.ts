import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { montar_dashboard } from "../servicos/montar-dashboard";

const schemaConsulta = z.object({
  usuarioId: z.string().uuid(),
  /** YYYY-MM-DD; default = hoje (fuso BR no serviço). */
  data: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export async function registrar_rotas_dashboard(app: FastifyInstance) {
  app.get("/", async (requisicao) => {
    const { usuarioId, data } = schemaConsulta.parse(requisicao.query);
    return montar_dashboard(usuarioId, data);
  });
}
