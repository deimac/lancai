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

export const schemaAssociarContaExterna = z.object({
  usuarioId: z.string().uuid(),
  contaId: z.string().uuid().optional(),
  cartaoId: z.string().uuid().optional(),
});

export const schemaUsuarioDaRequisicao = z.object({ usuarioId: z.string().uuid() });

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
