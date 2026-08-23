# PROMPT PARA AGENTE EXECUTOR — IMPLEMENTAÇÃO FASE 1 ASSISTENTE 2.0

---

## CONTEXTO

Você é o **agente executor** que vai implementar a **Fase 1 do Assistente 2.0 do LançAI**.

A arquitetura já foi definida, revisada criticamente e aprovada. Todos os contratos, tasks, specs de teste e migrations estão prontos.

**Seu objetivo:** Implementar as 9 tasks da Fase 1 em ordem sequencial, com testes passando a cada etapa.

---

## ARQUIVOS DE REFERÊNCIA (LEIA ANTES DE COMEÇAR)

### Arquitetura e Contratos
- `docs/ARQUITETURA_ASSISTENTE_2.0.md` — Arquitetura completa (4 camadas, contratos, segurança, migração)
- `docs/IMPLEMENTACAO_FASE1_TASKS.md` — Visão geral: 9 tasks, 18 dias, ordem, convenções
- `pacotes/tipos/src/assistente-v2.ts` — **Contratos Zod canônicos** (UserRequest, ResolvedRequest, ConversationState, PolicyDecision, SimpleCommand, etc.)

### Tasks Individuais (em `docs/tasks/`)
1. `task-01-session-manager.md` — Migration + SessionManager (lock, version, dedup WA)
2. `task-02-semantic-parser.md` — SemanticParser v2 (atalhos + LLM fallback, references estruturadas)
3. `task-03-reference-resolver.md` — ReferenceResolver (pipeline 5 estágios, sem LLM fallback)
4. `task-04-policy-engine.md` — PolicyEngine (3 regras: none/confirm/blocked + OF blocks)
5. `task-05-commands.md` — 6 SimpleCommand Handlers (create/update/cancel/query/recurrence/rule)
6. `task-06-application-service.md` — ApplicationService (transação, idempotência, re-validação, auditoria)
7. `task-07-state-updater.md` — StateUpdater (version++, invalidação lastResultSet, currentEntity)
8. `task-08-assistente-core.md` — AssistenteCore + Feature Flags + Shadow Mode + Web/WA integration

### Testes
- `docs/tasks/test-specs.md` — 6 suítes obrigatórias (SessionManager, SemanticParser, ReferenceResolver, PolicyEngine, Commands, E2E 30 conversas, WAR metric)

### Código Base
- `pacotes/banco/drizzle/0026_conversation_state.sql` — Migration pronta para rodar
- `pacotes/tipos/src/assistente-v2.ts` — Tipos Zod/TypeScript completos

---

## ORDEM DE EXECUÇÃO OBRIGATÓRIA

```
1. Migration 0026 → roda no banco
2. Task 1: SessionManager          (usa migration)
3. Task 2: SemanticParser v2       (usa SessionManager)
4. Task 3: ReferenceResolver       (usa SemanticParser output)
5. Task 4: PolicyEngine            (usa ResolvedRequest)
6. Task 5: SimpleCommand Handlers  (usa PolicyEngine decision)
7. Task 6: ApplicationService      (executa Commands no Core)
8. Task 7: StateUpdater            (atualiza ConversationState pós-execução)
9. Task 9: AssistenteCore          (orquestra tudo + feature flags)
```

**NÃO PULE ORDEM.** Cada task depende da anterior.

---

## REGRAS DE IMPLEMENTAÇÃO

### Convenções de Código
- **TypeScript strict mode** — zero erros `tsc --noEmit`
- **Testes first** — escreva testes antes ou junto com código
- **Zod validation** — use schemas de `assistente-v2.ts`
- **Result<T, E> pattern** — para operações que podem falhar
- **Logging estruturado** — `request.log.info/warn/error` com `traceId`
- **JSDoc** em funções públicas
- **Zero `any`** — tipagem estrita

### Estrutura de Arquivos Alvo
```
modulos/assistente/
├── agente/
│   ├── session-manager.ts
│   ├── semantic-parser-v2.ts
│   ├── reference-resolver.ts
│   ├── policy-engine.ts
│   ├── state-updater.ts
│   ├── assistente-core.ts
│   └── command-executor.ts
├── comandos/
│   ├── create-transaction.ts
│   ├── update-transaction.ts
│   ├── cancel-transaction.ts
│   ├── query-transactions.ts
│   ├── create-recurrence.ts
│   └── create-rule.ts
├── application/
│   └── application-service.ts
├── contratos/
│   └── assistente-v2.ts  (já existe em pacotes/tipos)
├── repositorio/
│   └── session-repository-drizzle.ts
└── __testes__/
    ├── session-manager.test.ts
    ├── semantic-parser-v2.test.ts
    ├── reference-resolver.test.ts
    ├── policy-engine.test.ts
    ├── commands.test.ts
    └── integration.test.ts
```

### Feature Flags (já definidos em `apps/api/src/config/feature-flags.ts`)
```typescript
ASSISTENTE_V2_SESSION, ASSISTENTE_V2_PARSER, ASSISTENTE_V2_RESOLVER,
ASSISTENTE_V2_POLICY, ASSISTENTE_V2_EXECUTE, ASSISTENTE_V2_CORE,
ASSISTENTE_V2_ASSISTANT, ASSISTENTE_V2_SHADOW
```

---

## CHECKLIST DE QUALIDADE POR TASK

Antes de marcar task como concluída:
- [ ] TypeScript strict mode passa (`pnpm typecheck`)
- [ ] Testes unitários ≥ 90% cobertura (`pnpm test`)
- [ ] Testes de integração passam
- [ ] Lint passa (`pnpm lint`)
- [ ] Build passa (`pnpm build`)
- [ ] Logs estruturados com `traceId`
- [ ] Tratamento de erros com `Result<T, E>`
- [ ] Idempotência testada (duplicação messageId, idempotencyKey)
- [ ] Concorrência testada (lock, version conflicts)
- [ ] Documentação inline (JSDoc) em funções públicas

---

## CRITÉRIO DE CONCLUSÃO FASE 1

| Métrica | Threshold |
|---------|-----------|
| WAR (Wrong Action Rate) em staging | **0** |
| Latência p95 | **< 3s** |
| Regressões na suite 16-ASSISTENTE | **0** |
| Testes E2E críticos (30 conversas) | **30/30 passam** |
| TypeScript strict | **0 erros** |

---

## COMO INICIAR

### 1. Rode a Migration
```bash
cd /Users/deimac/Documents/Projetos/lancai/pacotes/banco
pnpm db:migrate
```
Verifique se `sessao.contexto` (JSONB) e `sessao_message_id` foram criados.

### 2. Implemente Task 1: SessionManager
Siga `docs/tasks/task-01-session-manager.md`:
- `modulos/assistente/agente/session-manager.ts`
- `modulos/assistente/repositorio/session-repository-drizzle.ts`
- Testes em `modulos/assistente/__testes__/session-manager.test.ts`

### 3. Valide
```bash
pnpm --filter @lancai/assistente test
pnpm --filter @lancai/assistente typecheck
pnpm --filter @lancai/assistente lint
```

### 4. Continue Sequencialmente
Task 2 → Task 3 → ... → Task 9.

---

## COMANDOS ÚTEIS

```bash
# Testes
pnpm --filter @lancai/assistente test           # unit
pnpm --filter @lancai/assistente test:integration
pnpm --filter @lancai/assistente test:coverage

# Typecheck
pnpm --filter @lancai/assistente typecheck

# Build
pnpm --filter @lancai/assistente build

# Migration
cd pacotes/banco && pnpm db:migrate
```

---

## PRINCÍPIOS NÃO NEGOCIÁVEIS

1. **Segurança financeira > elegância** — Core é autoridade; PolicyEngine bloqueia antes de executar
2. **Referências determinísticas** — Pipeline 5 estágios; SEM LLM fallback; ambíguo = pergunta
3. **Comandos atômicos** — 1 comando = 1 transação Core; OperationPlan só para compostas reais
4. **Estado mínimo** — ConversationState com 6 campos; versão otimista; invalidação local
3. **Idempotência em 2 níveis** — messageId (turno) + idempotencyKey (operação financeira)
4. **Migração incremental** — Feature flags ON/OFF/SHADOW; legacy roda em paralelo

---

## SINAL DE INÍCIO

Quando estiver pronto, responda:

> **"INICIANDO TASK 1: SessionManager"**

E comece a implementação. Boa sorte! 🚀

---

*Arquivo gerado automaticamente — não edite manualmente. Use como referência durante toda a implementação.*