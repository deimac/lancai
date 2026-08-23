-- ConversationState v1 para Assistente 2.0
-- Armazena estado da conversa com versionamento otimista

ALTER TABLE sessao ADD COLUMN IF NOT EXISTS contexto jsonb DEFAULT '{
  "schemaVersion": 1,
  "version": 0,
  "lastResultSet": null,
  "currentEntity": null,
  "pendingConfirmation": null,
  "explicitPeriod": null,
  "userPreferencesRef": null
}'::jsonb;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS sessao_contexto_version_idx ON sessao ((contexto->>'version'));--> statement-breakpoint

CREATE TABLE IF NOT EXISTS sessao_message_id (
  message_id text NOT NULL,
  session_id uuid NOT NULL REFERENCES sessao(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS sessao_message_id_created_at_idx ON sessao_message_id (created_at);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS assistente_idempotency (
  key uuid PRIMARY KEY,
  resultado jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS assistente_idempotency_created_at_idx ON assistente_idempotency (created_at);--> statement-breakpoint

COMMENT ON COLUMN sessao.contexto IS 'ConversationState v1 serializado: schemaVersion, version, lastResultSet, currentEntity, pendingConfirmation, explicitPeriod, userPreferencesRef';--> statement-breakpoint

COMMENT ON TABLE sessao_message_id IS 'Deduplicação de messageId WhatsApp (TTL 24h via SessionManager)';--> statement-breakpoint

COMMENT ON TABLE assistente_idempotency IS 'Idempotência de comando do Assistente 2.0 (TTL 24h)';
