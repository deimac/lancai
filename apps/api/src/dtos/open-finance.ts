import { z } from "zod";

export const schemaIniciarConexao = z.object({
  usuarioId: z.string().uuid(),
  /** Preenchido quando é reconexão de uma conexão que precisa de atenção. */
  conexaoId: z.string().uuid().optional(),
});

export const schemaRegistrarConexao = z.object({
  usuarioId: z.string().uuid(),
  /** Identificador que o widget do provedor devolveu. Opaco para nós. */
  conexaoExterna: z.string().min(1),
});

/** Preview de itemId antes do pareamento (Reconectar). */
export const schemaInspecionarItem = z.object({
  usuarioId: z.string().uuid(),
  conexaoExterna: z.string().min(1),
});

export const schemaReatacharConexao = z.object({
  usuarioId: z.string().uuid(),
  conexaoExterna: z.string().min(1),
  pareamentos: z
    .array(
      z.object({
        contaExternaId: z.string().min(1),
        contaId: z.string().uuid().optional(),
        cartaoId: z.string().uuid().optional(),
      }),
    )
    .max(50)
    .default([]),
  /** Conexão a atualizar in-place (mesma linha, novo itemId). */
  conexaoId: z.string().uuid().optional(),
  conexaoIdAnterior: z.string().uuid().optional(),
});

export const schemaAssociarContaExterna = z.object({
  usuarioId: z.string().uuid(),
  contaId: z.string().uuid().optional(),
  cartaoId: z.string().uuid().optional(),
});

export const schemaUsuarioDaRequisicao = z.object({ usuarioId: z.string().uuid() });

/** Fallback Meu Pluggy: item antigo sumiu, usuário informa o novo itemId. */
export const schemaAtualizarItemId = z.object({
  usuarioId: z.string().uuid(),
  novoItemId: z.string().min(1),
});

/** Só usado com `OPEN_FINANCE_PROVEDOR=duble` — criar conexão sem widget. */
export const schemaCriarConexaoDuble = z.object({
  usuarioId: z.string().uuid(),
});

/** Seméia lote de mentira e dispara a mesma ingestão do webhook. */
export const schemaSincronizarDuble = z.object({
  usuarioId: z.string().uuid(),
  movimentos: z
    .array(
      z.object({
        valor: z.number().positive(),
        tipo: z.enum(["receita", "despesa"]),
        descricaoFonte: z.string().min(1).max(500),
        ocorridoEm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .max(50)
    .optional(),
});
