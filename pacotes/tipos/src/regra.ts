import { z } from "zod";
import { perfilSchema } from "./cadastro";

export const origemRegraSchema = z.enum(["manual", "aprendizado_conversa"]);
export type OrigemRegra = z.infer<typeof origemRegraSchema>;

export const tipoCondicaoRegraSchema = z.enum(["descricao_contem"]);
export type TipoCondicaoRegra = z.infer<typeof tipoCondicaoRegraSchema>;

export const schemaCriarRegra = z.object({
  workspaceId: z.string().uuid(),
  origem: origemRegraSchema.default("manual"),
  condicaoTipo: tipoCondicaoRegraSchema.default("descricao_contem"),
  /** Trecho procurado na descrição. Mínimo 2 para não casar com ruído. */
  condicaoValor: z.string().trim().min(2).max(120),
  categoriaId: z.string().uuid(),
  perfil: perfilSchema.optional(),
});
/** Entrada do chamador — `origem` e `condicaoTipo` têm default no parse. */
export type EntradaCriarRegra = z.input<typeof schemaCriarRegra>;
