-- ConversationContext (Assistente 2.0 definitivo): campos v3 aditivos no JSONB
-- de sessao.contexto. Não remove chaves v1 (lastResultSet, currentEntity,
-- pendingConfirmation, explicitPeriod, userPreferencesRef). schemaVersion
-- permanece 1 no banco até o SessionManager migrar na integração.

ALTER TABLE sessao ALTER COLUMN contexto SET DEFAULT '{
  "schemaVersion": 1,
  "version": 0,
  "lastResultSet": null,
  "currentEntity": null,
  "pendingConfirmation": null,
  "explicitPeriod": null,
  "userPreferencesRef": {},
  "active_topic": null,
  "active_goal": null,
  "focused_entity": null,
  "pending_action": null,
  "topic_history": [],
  "updated_at": 1
}'::jsonb;--> statement-breakpoint

UPDATE sessao
SET contexto = '{
  "schemaVersion": 1,
  "version": 0,
  "lastResultSet": null,
  "currentEntity": null,
  "pendingConfirmation": null,
  "explicitPeriod": null,
  "userPreferencesRef": {},
  "active_topic": null,
  "active_goal": null,
  "focused_entity": null,
  "pending_action": null,
  "topic_history": [],
  "updated_at": 1
}'::jsonb
WHERE contexto IS NULL;--> statement-breakpoint

UPDATE sessao
SET contexto = contexto || jsonb_build_object(
  'active_topic', COALESCE(contexto->'active_topic', 'null'::jsonb),
  'active_goal', COALESCE(contexto->'active_goal', 'null'::jsonb),
  'focused_entity', COALESCE(contexto->'focused_entity', 'null'::jsonb),
  'pending_action', COALESCE(contexto->'pending_action', 'null'::jsonb),
  'topic_history', COALESCE(contexto->'topic_history', '[]'::jsonb),
  'updated_at', COALESCE(contexto->'updated_at', '1'::jsonb)
)
WHERE contexto IS NOT NULL
  AND (
    NOT (contexto ? 'topic_history')
    OR NOT (contexto ? 'active_topic')
    OR NOT (contexto ? 'pending_action')
    OR NOT (contexto ? 'updated_at')
  );--> statement-breakpoint

COMMENT ON COLUMN sessao.contexto IS 'Estado da conversa: ConversationState v1 (SessionManager) + campos ConversationContext (active_topic, active_goal, focused_entity, pending_action, topic_history, updated_at). schemaVersion 1 no banco até a integração v3.';
