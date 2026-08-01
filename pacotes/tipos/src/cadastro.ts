import { z } from "zod";

export const perfilSchema = z.enum(["pf", "pj"]);
export type Perfil = z.infer<typeof perfilSchema>;

export const schemaCriarUsuario = z.object({
  nome: z.string().min(1),
  email: z.string().email(),
});
export type EntradaCriarUsuario = z.infer<typeof schemaCriarUsuario>;

export const schemaCriarConta = z.object({
  nome: z.string().min(1),
  saldoInicial: z.number().default(0),
  perfil: perfilSchema,
  usuarioId: z.string().uuid(),
});
export type EntradaCriarConta = z.infer<typeof schemaCriarConta>;

export const schemaCriarCartao = z.object({
  nome: z.string().min(1),
  limite: z.number().positive(),
  fechamento: z.number().int().min(1).max(31),
  vencimento: z.number().int().min(1).max(31),
  perfil: perfilSchema,
  contaId: z.string().uuid(),
  usuarioId: z.string().uuid(),
});
export type EntradaCriarCartao = z.infer<typeof schemaCriarCartao>;

export const schemaCriarCategoria = z.object({
  nome: z.string().min(1),
  tipo: z.enum(["receita", "despesa", "ambos"]),
  usuarioId: z.string().uuid(),
});
export type EntradaCriarCategoria = z.infer<typeof schemaCriarCategoria>;

export const schemaCriarPessoa = z.object({
  nome: z.string().min(1),
  tipo: z.enum(["cliente", "fornecedor", "socio", "funcionario", "familiar"]),
  usuarioId: z.string().uuid(),
});
export type EntradaCriarPessoa = z.infer<typeof schemaCriarPessoa>;
