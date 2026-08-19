import { z } from "zod";
import { perfilSchema } from "./cadastro";

export const origemRegraSchema = z.enum(["manual", "aprendizado_conversa"]);
export type OrigemRegra = z.infer<typeof origemRegraSchema>;

export const logicaCondicoesRegraSchema = z.enum(["e", "ou"]);
export type LogicaCondicoesRegra = z.infer<typeof logicaCondicoesRegraSchema>;

export const campoCondicaoRegraSchema = z.enum([
  "descricao",
  "valor",
  "data",
  "tipo",
  "conta",
  "cartao",
]);
export type CampoCondicaoRegra = z.infer<typeof campoCondicaoRegraSchema>;

export const operadorCondicaoRegraSchema = z.enum([
  "comeca_com",
  "contem",
  "nao_contem",
  "igual",
  "diferente",
  "termina_com",
  "regex",
]);
export type OperadorCondicaoRegra = z.infer<typeof operadorCondicaoRegraSchema>;

export const schemaCondicaoRegra = z.object({
  campo: campoCondicaoRegraSchema,
  operador: operadorCondicaoRegraSchema,
  /** Texto, número, UUID, data ISO (YYYY-MM-DD) ou enum de tipo — conforme o campo. */
  valor: z.string().trim().min(1).max(200),
});
export type CondicaoRegra = z.infer<typeof schemaCondicaoRegra>;

export const schemaAcaoDefinirCategoria = z.object({
  tipo: z.literal("definir_categoria"),
  categoriaId: z.string().uuid(),
});

export const schemaAcaoDefinirBeneficiario = z.object({
  tipo: z.literal("definir_beneficiario"),
  pessoaId: z.string().uuid(),
});

export const schemaAcaoAdicionarTagsNotas = z.object({
  tipo: z.literal("adicionar_tags_notas"),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  observacoes: z.string().trim().max(500).optional(),
});

export const schemaAcaoIgnorarTransacao = z.object({
  tipo: z.literal("ignorar_transacao"),
});

export const schemaAcaoDefinirPerfil = z.object({
  tipo: z.literal("definir_perfil"),
  perfil: perfilSchema,
});

export const schemaAcaoMarcarPagamentoFatura = z.object({
  tipo: z.literal("marcar_pagamento_fatura"),
});

export const schemaAcaoRegra = z.discriminatedUnion("tipo", [
  schemaAcaoDefinirCategoria,
  schemaAcaoDefinirBeneficiario,
  schemaAcaoAdicionarTagsNotas,
  schemaAcaoIgnorarTransacao,
  schemaAcaoDefinirPerfil,
  schemaAcaoMarcarPagamentoFatura,
]);
export type AcaoRegra = z.infer<typeof schemaAcaoRegra>;

/** Compat: regras antigas só tinham `descricao_contem`. */
export const tipoCondicaoRegraSchema = z.enum(["descricao_contem"]);
export type TipoCondicaoRegra = z.infer<typeof tipoCondicaoRegraSchema>;

export const schemaCriarRegra = z.object({
  workspaceId: z.string().uuid(),
  origem: origemRegraSchema.default("manual"),
  nome: z.string().trim().min(1).max(120),
  logicaCondicoes: logicaCondicoesRegraSchema.default("ou"),
  condicoes: z.array(schemaCondicaoRegra).min(1).max(20),
  acoes: z.array(schemaAcaoRegra).min(1).max(10),
  ativa: z.boolean().optional().default(true),
  /** Se true, reaplica no histórico do workspace (exceto classificado pelo usuário). */
  aplicarExistentes: z.boolean().optional().default(false),
});
/** Entrada do chamador — defaults aplicados no parse. */
export type EntradaCriarRegra = z.input<typeof schemaCriarRegra>;

export const schemaAtualizarRegra = z.object({
  nome: z.string().trim().min(1).max(120).optional(),
  logicaCondicoes: logicaCondicoesRegraSchema.optional(),
  condicoes: z.array(schemaCondicaoRegra).min(1).max(20).optional(),
  acoes: z.array(schemaAcaoRegra).min(1).max(10).optional(),
  ativa: z.boolean().optional(),
  aplicarExistentes: z.boolean().optional().default(false),
});
export type EntradaAtualizarRegra = z.input<typeof schemaAtualizarRegra>;
