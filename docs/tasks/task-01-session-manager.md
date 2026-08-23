# Task 1: Migration ConversationState

## Arquivo: `pacotes/banco/drizzle/0026_conversation_state.sql`

## Objetivo
Adicionar coluna `contexto` (JSONB) na tabela `sessao` para armazenar `ConversationState` com versionamento otimista.

## SQL

```sql
-- 0026_conversation_state.sql
-- Adiciona estado da conversa v2 na tabela sessao

-- Coluna para armazenar ConversationState serializado (JSONB)
ALTER TABLE sessao ADD COLUMN contexto jsonb DEFAULT '{
  "schemaVersion": 1,
  "version": 0,
  "lastResultSet": null,
  "currentEntity": null,
  "pendingConfirmation": null,
  "explicitPeriod": null,
  "userPreferencesRef": null
}'::jsonb;

-- Índice para busca por versão (concorrência)
CREATE INDEX sessao_contexto_version_idx ON sessao ((contexto->>'version'));

-- Comentário
COMMENT ON COLUMN sessao.contexto IS 'ConversationState v1 serializado: schemaVersion, version, lastResultSet, currentEntity, pendingConfirmation, explicitPeriod, userPreferencesRef';
```

## Validação
- [ ] Migration roda sem erro: `pnpm --filter @lancai/banco db:migrate`
- [ ] Coluna `contexto` existe em `sessao` com default correto
- [ ] Índice criado
- [ ] Dados existentes mantidos (default preenche)

---

## Task 1b: SessionManager

## Arquivo: `modulos/assistente/agente/session-manager.ts`

## Contratos (de `assistente-v2.ts`)

```typescript
interface ConversationState { /* ver assistente-v2.ts */ }
interface SessionRecord { id: string; contexto: ConversationState; updatedAt: Date; }
```

## Interface

```typescript
interface SessionManager {
  // Carrega ou cria sessão para usuário
  obterOuCriar(usuarioId: string, canal: "web" | "whatsapp", sessaoId?: string): Promise<SessionRecord>;
  
  // Atualiza estado com optimistic locking
  atualizarEstado(sessionId: string, updater: (state: ConversationState) => ConversationState): Promise<ConversationState>;
  
  // Verifica se messageId já foi processado (WhatsApp)
  jaProcessado(messageId: string): Promise<boolean>;
  
  // Marca messageId como processado
  marcarProcessado(messageId: string, sessionId: string): Promise<void>;
  
  // Limpa messageIds antigos (TTL 24h)
  limparMessageIdsAntigos(): Promise<void>;
}
```

## Implementação Detalhada

### 1. Lock por Sessão (Redis ou Postgres Advisory Lock)
```typescript
private async adquirirLock(sessionId: string): Promise<boolean> {
  // Opção A: Redis SETNX com TTL 30s
  // Opção B: PG advisory lock: SELECT pg_try_advisory_xact_lock(hash(sessionId))
  // Opção C: Row lock: SELECT * FROM sessao WHERE id = $1 FOR UPDATE
}
```

### 2. Optimistic Versioning
```typescript
async atualizarEstado(sessionId: string, updater: (state: ConversationState) => ConversationState) {
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const session = await this.repo.get(sessionId);
    const currentVersion = session.contexto.version;
    const newState = updater(session.contexto);
    newState.version = currentVersion + 1;
    
    const updated = await this.repo.compareAndSwap(sessionId, currentVersion, newState);
    if (updated) return newState;
    
    await sleep(50 * (attempt + 1)); // backoff
  }
  throw new Error("Concurrency conflict: max retries exceeded");
}
```

### 3. Deduplicação WhatsApp
```typescript
async jaProcessado(messageId: string): Promise<boolean> {
  const record = await this.messageIdRepo.findByMessageId(messageId);
  return !!record;
}

async marcarProcessado(messageId: string, sessionId: string) {
  await this.messageIdRepo.upsert({ messageId, sessionId, createdAt: new Date() });
}
```

## Testes Obrigatórios

| Teste | Descrição |
|-------|-----------|
| `obterOuCriar` cria nova sessão se não existe | Web: novo sessaoId; WA: reusa sessao ativa |
| `obterOuCriar` carrega estado existente | version incrementa a cada atualização |
| `atualizarEstado` incrementa version | version++ a cada commit bem-sucedido |
| `atualizarEstado` falha em race condition | 2 updates simultâneos → 1 succeeds, 1 retry |
| `atualizarEstado` retries com backoff | 3 retries com 50ms, 100ms, 150ms |
| `jaProcessado` detecta duplicata WA | Mesmo messageId → true na 2ª chamada |
| `marcarProcessado` persiste messageId | Recuperável após restart |
| Lock expira em falha | Lock liberado mesmo se erro na atualização |

---

## Task 1c: Repository (Drizzle)

## Arquivo: `modulos/assistente/repositorio/session-repository-drizzle.ts`

```typescript
interface SessionRepositoryDrizzle {
  get(sessionId: string): Promise<SessionRecord | null>;
  getByUsuarioCanal(usuarioId: string, canal: "web" | "whatsapp"): Promise<SessionRecord | null>;
  create(record: SessionRecord): Promise<SessionRecord>;
  compareAndSwap(sessionId: string, expectedVersion: number, newState: ConversationState): Promise<boolean>;
  updateMessageIds(sessionId: string, messageIds: string[]): Promise<void>;
}
```

## Implementação
- Usar `drizzle` com transação para `compareAndSwap`
- `messageIds` armazenados em tabela separada `sessao_message_id` (messageId, sessionId, createdAt)
- TTL via job cron ou `createdAt` filter

---

## Critério de Conclusão Task 1
- [ ] Migration `0026` roda em staging/prod
- [ ] `SessionManager` passa todos os testes unitários
- [ ] Concorrência testada: 100 updates simultâneos → 0 lost updates
- [ ] WhatsApp deduplicação: 1000 mensagens duplicadas → 0 processadas 2x
- [ ] Lock expira corretamente em erro