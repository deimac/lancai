# Assistente 2.0 definitivo — Semana 1

O que entrou no código na **Semana 1** da arquitetura definitiva ([ARQUITETURA_ASSISTENTE_2.0_FINAL.md](ARQUITETURA_ASSISTENTE_2.0_FINAL.md)): contratos Zod e migration aditiva de `ConversationContext`.

**Este documento não cobre:** o mapa operacional do chat atual — [16-ASSISTENTE.md](16-ASSISTENTE.md). A Fase 1 antiga (SemanticParser, SessionManager, Policy, comandos) — [IMPLEMENTACAO_FASE1_TASKS.md](IMPLEMENTACAO_FASE1_TASKS.md). Semanas 2–4 (extractor, planners, integração).

---

## 1. Contexto

Princípio da arquitetura definitiva: o LLM entende **uma vez** no início (`ConversationUnderstanding`). Need, Plan, Policy e Core são determinísticos. Atalhos semânticos (regex de “quanto gastei”, “corrige o Uber”) deixam de ser a inteligência principal.

A Semana 1 **não ligou** esse pipeline. O chat e o WhatsApp continuam no caminho legado (`processar_turno_conversa` + `IntencaoDetectada`) e, se a flag estiver ligada, no Assistente 2.0 antigo (`UserRequest` + `SemanticParserV2` + atalhos `@lancai/ia`). Flags `ASSISTENTE_V2_*` não mudaram.

O que a Semana 1 fez foi deixar os **contratos** e o **JSONB da sessão** prontos para a Semana 2, sem quebrar o `SessionManager` que ainda lê `ConversationState` (`schemaVersion: 1`).

```text
Semana 1 (feito)     tipos + migration 0033
Semana 2 (feito)     UnderstandingExtractor (LLM puro)
Semana 3 (feito)     UnderstandingToNeed → QueryPlanner / CommandPlanner
Semana 4 (feito)     AssistenteCore V3 + flags (default off)
Suíte 35 (feito)     conversas críticas E2E no Core V3 (extractor mockado)
Próximo              shadow local: ASSISTENTE_V3_SHADOW=true, ASSISTENTE_V3_ASSISTANT=false
```

---

## 2. Arquivos

| Arquivo | Papel |
|---|---|
| [pacotes/tipos/src/assistente-v3.ts](../pacotes/tipos/src/assistente-v3.ts) | Schemas Zod, helpers, adapter v1↔v3 |
| [pacotes/tipos/src/index.ts](../pacotes/tipos/src/index.ts) | `export * from "./assistente-v3"` (v2 permanece) |
| [pacotes/tipos/src/__testes__/assistente-v3.test.ts](../pacotes/tipos/src/__testes__/assistente-v3.test.ts) | 10 testes |
| [pacotes/banco/drizzle/0033_conversation_context.sql](../pacotes/banco/drizzle/0033_conversation_context.sql) | JSONB aditivo em `sessao.contexto` |
| [pacotes/banco/drizzle/meta/_journal.json](../pacotes/banco/drizzle/meta/_journal.json) | Tag `0033_conversation_context` (idx 33) |
| [pacotes/banco/src/schema/sessao.ts](../pacotes/banco/src/schema/sessao.ts) | Só o comentário da coluna `contexto` |

**Não alterados:** `SessionManager`, `AssistenteCore`, `PolicyEngine`, `ApplicationService`, `semantic-parser-v2.ts`, atalhos em `@lancai/ia`. [pacotes/tipos/src/assistente-v2.ts](../pacotes/tipos/src/assistente-v2.ts) continua a fonte do estado persistido hoje.

Reuso explícito do v2 (não duplicar): `PeriodSpecSchema`, `EntityRefSchema`, `EntityReferenceSchema`, `QuerySpecSchema`, `SimpleCommandSchema`, `ConfirmationRequestSchema`, `UserPreferencesRefSchema`.

---

## 3. Contratos Zod

Fonte: `ConversationUnderstandingSchema` e demais em `assistente-v3.ts`. O snippet do FINAL tinha bugs; o código fechou o contrato assim:

| Problema no FINAL | Decisão no código |
|---|---|
| `version` duplicado no `ConversationContext` | Um só: o do CAS (`version`), o mesmo número que o SessionManager já incrementa |
| `schemaVersion: 1` no contexto novo | **`schemaVersion: 2` em memória**; o banco permanece `1` até a integração |
| Fluxo 1 usava `continuation.type: "temporal"` | Enum do schema (`period_shift`, `correction`, …). “Foi ontem” = `correction` + `EntityReference.temporal` |
| Fluxos com `contaId` / `valor` no Understanding | LLM devolve **nomes**: `account`, `card`, `merchant`, `amount`. IDs só depois do Resolver (Semana 4) |
| `InformationNeed` no create | `goal: execute` vai a `CommandPlan` **sem** Need de agregação |

### 3.1 Auxiliares

- **`Ambiguity`:** `field`, `reason`, `candidates?`
- **`TransactionFilters`:** merchant, descricao, periodo (`PeriodSpec`), tipos, conta/cartão por **nome ou id**, categoria, perfil, pessoa, tags
- **`QueryResultSummary`:** `count`, `total?`, `period?`
- **`DataSource`:** `transactions` \| `accounts` \| `cards` \| `recurrences` \| `categories`

### 3.2 ConversationUnderstanding (saída do LLM)

Campos:

- `goal`: `answer` \| `execute` \| `clarify` \| `confirm` \| `greet` \| `continue`
- `question?`: `intent` + `entities` + `implicit_filters` + `ambiguity`
- `continuation?`: tipo + `EntityReference` + `inherits_from_previous`
- `explicit_references?`, `ambiguity?`
- `confidence` (0–1)
- `required_sources`

`intent`: `total`, `list`, `detail`, `compare`, `explain`, `trend`, `top`, `breakdown`, `projection`, `create`, `update`, `delete`.

`entities` (nomes, não IDs): `merchant`, `category`, `account`, `card`, `period`, `metric`, `computation`, `amount`, `value`.

`continuation.type`: `period_shift`, `filter_add`, `filter_remove`, `entity_ref`, `correction`, `detail_request`, `filter_modify`.

### 3.3 InformationNeed (o que buscar)

Usado em consultas (`goal: answer` / `continue`), não obrigatório no create.

- `data_sources` (mín. 1)
- `filters.transactions` / `.accounts` / `.cards`
- `aggregation?` (`sum` \| `count` \| `avg` \| `max` \| `min` \| `none` + `field` + `group_by?`)
- `computation?` (`diff`, `pct_change`, `trend`, `top_n`, `breakdown`, `explanation`, `comparison`)
- `expected_output`: `single_value` \| `list` \| `table` \| `comparison` \| `explanation` \| `chart`
- `source_priority`

Helper: `informationNeedDeQuerySpec(spec)` deriva Need a partir de um `QuerySpec` v2 (para o adapter de `lastResultSet`).

### 3.4 QueryPlan e CommandPlan

Discriminated union `ExecutionPlan` no campo `type`:

- **`query`:** `spec: QuerySpec` (v2) + `computation?` (inclui `none`)
- **`command`:** `steps[]` com `stepId`, `description`, `dependsOn?`, `command: SimpleCommand` (create/update/cancel/query_transactions/create_recurrence/create_rule)

Um create típico é **um** step `create_transaction`, sem `InformationNeed`.

### 3.5 ConversationContext (`schemaVersion: 2`)

Estado da conversa para o pipeline novo (ainda não persistido como versão 2):

| Campo | Significado |
|---|---|
| `version` | CAS / optimistic lock (espelha o v1) |
| `active_topic` | domínio, entidades, métrica, período |
| `active_goal` | `explore` \| `analyze` \| `execute` \| `correct` \| `configure` |
| `last_query` | Need + `query_spec` + `result_ids` + resumo + `expires_at` |
| `focused_entity` | entidade em foco (`EntityRef`) |
| `pending_action` | `confirmation` \| `clarification` \| `slot_fill` + `payload` |
| `topic_history` | no máx. 10 |
| `topic_preferences` | período/conta/cartão default do tópico |
| `user_preferences` | preferências v1 (`UserPreferencesRef`) — extra para o adapter não perder dados |
| `updated_at` | epoch ms (> 0) |

`active_topic`, `active_goal`, `focused_entity` e `pending_action` são **nullable** (JSONB `null` vira `null`, não `undefined`).

---

## 4. Adapter v1 ↔ v3

O `SessionManager` continua gravando e lendo `ConversationState` (`schemaVersion: 1`). Quem precisa do contexto novo chama o adapter.

| ConversationState (v1) | ConversationContext (v3) |
|---|---|
| `version` | `version` |
| `lastResultSet.ids` / `.query` / `.expiresAt` | `last_query.result_ids` / `.query_spec` / `.expires_at` (+ Need derivado) |
| `currentEntity` | `focused_entity` |
| `pendingConfirmation` | `pending_action` `{ type: "confirmation", payload }` |
| `explicitPeriod` | `active_topic.period` e `topic_preferences.default_period` |
| `userPreferencesRef` | `user_preferences` |

Funções:

- `estadoInicialConversacaoV3(agora?)` — contexto vazio schema 2
- `contextoV3DeEstadoV1(state, agora?)` — promove v1
- `estadoV1DeContextoV3(ctx)` — volta ao formato do SessionManager (`schemaVersion: 1`)
- `normalizarConversationContext(bruto, agora?)` — aceita JSON da 0032 **e** documento misto da 0033; devolve sempre schema 2 **em memória**; sobrepõe campos v3 se já existirem no JSON

Constantes de fixture: `CONTEXTO_SESSAO_DEFAULT_V1` (default 0032), `CONTEXTO_SESSAO_DEFAULT_MISTO` (default 0033).

---

## 5. Migration `0033_conversation_context`

JSONB **aditivo** em `sessao.contexto`. Não apaga `lastResultSet`, `currentEntity`, `pendingConfirmation`, `explicitPeriod`, `userPreferencesRef`. **Não** grava `schemaVersion: 2`.

1. Novo `DEFAULT` da coluna: documento unificado (chaves v1 + `active_topic`, `active_goal`, `focused_entity`, `pending_action`, `topic_history: []`, `updated_at: 1`).
2. `UPDATE` onde `contexto IS NULL` → esse default.
3. `UPDATE` nas linhas que ainda não têm `topic_history` / `active_topic` / `pending_action` / `updated_at`: `contexto || jsonb_build_object(...)` só preenche o que falta (`COALESCE` preserva valor já existente).
4. `COMMENT ON COLUMN` atualizado.

Tipo Drizzle da coluna continua `Record<string, unknown>`. A migration **já foi aplicada** no banco do projeto (`pnpm --filter @lancai/banco db:migrate`).

O `SessionManager` ignora as chaves extras: `ConversationStateSchema.parse` descarta o que não conhece (strip do Zod).

---

## 6. Testes

Arquivo: `pacotes/tipos/src/__testes__/assistente-v3.test.ts` (10 casos).

| Caso | O que garante |
|---|---|
| Consulta Uber `goal: answer` + `intent: total` | merchant no Understanding |
| Create Uber R$ 50 na Nubank | nomes (`account`, `amount`), sem `contaId` |
| Continuação `period_shift` | `inherits_from_previous` + ref temporal `last_month` |
| Goal `chat` | rejeição Zod |
| QueryPlan listagem | `type: query` |
| CommandPlan create | um step `create_transaction` sem Need |
| Default 0032 | `normalizarConversationContext` promove a schema 2 |
| Default 0033 | misto lê v3 e `estadoV1DeContextoV3` volta a schema 1 |
| Roundtrip v1→v3→v1 | preserva `lastResultSet.ids`, `currentEntity`, `pendingConfirmation`, `version`, período, preferências |
| Estado inicial v3 | não quebra `estadoInicialConversacao()` v1 |

Rodar: `pnpm --filter @lancai/tipos test`.

---

## 7. O que esta semana não fez

- `UnderstandingExtractor` (única chamada LLM)
- `UnderstandingToNeed`, `QueryPlanner`, `CommandPlanner`
- `ContextUpdater` no lugar do `StateUpdater`
- Ligar o `AssistenteCore` no caminho Understanding → Need → Plan
- Flag `ASSISTENTE_V3_*` / shadow
- Remover atalhos regex do `@lancai/ia`

**Próximo passo:** Semana 2 — `UnderstandingExtractor`: mensagem + `ConversationContext` + 8 turnos → `ConversationUnderstanding`. Sem atalho semântico novo.
