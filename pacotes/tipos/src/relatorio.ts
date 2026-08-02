import { z } from "zod";
import { perfilSchema } from "./cadastro";

const dataISOSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato YYYY-MM-DD");

/**
 * Filtros de `CONSULTAR_VISAO` já resolvidos: os nomes em texto livre que a IA
 * devolve (`conta_nome`, `categoria_nome`...) foram traduzidos para IDs reais
 * pelo `ResolvedorIntencao` (modulos/ia) — é isso que o `modulos/relatorios`
 * efetivamente recebe para consultar/agregar dados. Mesma separação de
 * responsabilidades usada em `EntradaCriarMovimento`/`EntradaCorrigirMovimento`.
 */
export const schemaFiltrosVisaoResolvidos = z.object({
  usuarioId: z.string().uuid(),
  perfil: perfilSchema.optional(),
  contaId: z.string().uuid().optional(),
  cartaoId: z.string().uuid().optional(),
  categoriaId: z.string().uuid().optional(),
  pessoaId: z.string().uuid().optional(),
  periodo: z.object({ de: dataISOSchema, ate: dataISOSchema }).optional(),
});
export type FiltrosVisaoResolvidos = z.infer<typeof schemaFiltrosVisaoResolvidos>;
