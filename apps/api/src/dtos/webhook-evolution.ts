import { z } from "zod";

/**
 * Envelope padrão dos webhooks da Evolution API v2.
 * `data` e campos extras variam por tipo de evento — por isso usamos passthrough.
 */
export const schemaWebhookEvolution = z
  .object({
    event: z.string().min(1),
    instance: z.string().min(1),
    data: z.unknown().optional(),
    destination: z.string().optional(),
    date_time: z.union([z.string(), z.number()]).optional(),
    sender: z.string().optional(),
    server_url: z.string().optional(),
    apikey: z.string().optional(),
  })
  .passthrough();

export type DtoWebhookEvolution = z.infer<typeof schemaWebhookEvolution>;
