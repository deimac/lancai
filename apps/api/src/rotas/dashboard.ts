import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  montar_dashboard,
  perfil_de_tipo_gasto_dashboard,
} from "../servicos/montar-dashboard";

const schemaConsulta = z.object({
  usuarioId: z.string().uuid(),
  /** YYYY-MM-DD; default = hoje (fuso BR no serviço). */
  data: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Natureza: pessoal/pf, empresa/pj. Ausente = todos. Não filtra caixa/saldo. */
  tipoGasto: z.enum(["pf", "pj", "pessoal", "empresa"]).optional(),
});

export async function registrar_rotas_dashboard(app: FastifyInstance) {
  app.get("/", async (requisicao) => {
    const { usuarioId, data, tipoGasto } = schemaConsulta.parse(requisicao.query);
    return montar_dashboard(usuarioId, data, perfil_de_tipo_gasto_dashboard(tipoGasto));
  });
}
