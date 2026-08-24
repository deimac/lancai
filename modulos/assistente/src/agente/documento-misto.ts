import { estadoV1DeContextoV3, type ConversationContext } from "@lancai/tipos";
import type { SessionDocumento } from "../repositorio/tipos-sessao";

/**
 * JSONB persistido nesta semana: schemaVersion 1 (Core v2 continua válido)
 * + chaves v3 no mesmo documento. O ConversationContext em memória é schema 2.
 */
export function documentoMistoDeContextoV3(ctx: ConversationContext): SessionDocumento {
  const v1 = estadoV1DeContextoV3(ctx);
  return {
    ...v1,
    schemaVersion: 1,
    version: ctx.version,
    active_topic: ctx.active_topic ?? null,
    active_goal: ctx.active_goal ?? null,
    last_query: ctx.last_query ?? null,
    focused_entity: ctx.focused_entity ?? null,
    pending_action: ctx.pending_action ?? null,
    topic_history: ctx.topic_history ?? [],
    topic_preferences: ctx.topic_preferences ?? null,
    user_preferences: ctx.user_preferences ?? v1.userPreferencesRef ?? {},
    updated_at: ctx.updated_at,
  };
}
