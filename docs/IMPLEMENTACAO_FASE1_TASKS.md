# Implementação Fase 1 — Assistente 2.0

> **Objetivo:** Entregar MVP do Assistente 2.0 (9 componentes) com feature flags para migração incremental.
> **Critério de conclusão:** WAR = 0 em staging + latência p95 < 3s + 0 regressões.

---

## Visão Geral das Tasks

| # | Componente | Arquivo Principal | Dependências | Estimativa |
|---|------------|-------------------|--------------|------------|
| 1 | Migration ConversationState | `0026_conversation_state.sql` | — | 1 dia |
| 2 | SessionManager | `session-manager.ts` | Migration 1 | 2 dias |
| 3 | SemanticParser v2 | `semantic-parser-v2.ts` | SessionManager | 3 dias |
| 4 | ReferenceResolver | `reference-resolver.ts` | SemanticParser | 3 dias |
| 5 | PolicyEngine | `policy-engine.ts` | ReferenceResolver | 1 dia |
| 6 | SimpleCommand Handlers | `commands/*.ts` | PolicyEngine | 3 dias |
| 7 | ApplicationService | `application-service.ts` | Commands | 2 dias |
| 8 | StateUpdater | `state-updater.ts` | ApplicationService | 1 dia |
| 9 | AssistenteCore + Feature Flags | `assistente-core.ts` | Todos acima | 2 dias |

**Total estimado:** 18 dias úteis

---

## Ordem de Execução Obrigatória

```
1. Migration (0026) → roda no banco
2. SessionManager → usa migration
3. SemanticParser v2 → usa SessionManager (para state)
4. ReferenceResolver → usa SemanticParser output
5. PolicyEngine → usa ResolvedRequest
6. SimpleCommand Handlers → usa PolicyEngine decision
7. ApplicationService → executa Commands no Core
8. StateUpdater → atualiza ConversationState pós-execução
9. AssistenteCore → orquestra tudo + feature flags
```

---

## Convenções de Implementação

### Estrutura de Arquivos
```
modulos/assistente/
├── agente/
│   ├── session-manager.ts
│   ├── semantic-parser-v2.ts
│   ├── reference-resolver.ts
│   ├── policy-engine.ts
│   ├── state-updater.ts
│   └── assistente-core.ts
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
│   └── assistente-v2.ts
└── __testes__/
    ├── session-manager.test.ts
    ├── semantic-parser-v2.test.ts
    ├── reference-resolver.test.ts
    ├── policy-engine.test.ts
    ├── commands.test.ts
    └── integration.test.ts
```

### Padrões de Código
- **Tipagem estrita:** Todos os parâmetros e retornos tipados
- **Error handling:** `Result<T, E>` pattern para operações que podem falhar
- **Logging:** `request.log.info/warn/error` com `traceId`
- **Validação:** Zod schemas em `assistente-v2.ts`
- **Testes:** Vitest, 1 arquivo por módulo + integration tests

### Feature Flags
```typescript
// apps/api/src/config/feature-flags.ts
export const FEATURE_FLAGS = {
  ASSISTENTE_V2_SESSION: process.env.ASSISTENTE_V2_SESSION === "true",
  ASSISTENTE_V2_PARSER: process.env.ASSISTENTE_V2_PARSER === "true",
  ASSISTENTE_V2_RESOLVER: process.env.ASSISTENTE_V2_RESOLVER === "true",
  ASSISTENTE_V2_POLICY: process.env.ASSISTENTE_V2_POLICY === "true",
  ASSISTENTE_V2_EXECUTE: process.env.ASSISTENTE_V2_EXECUTE === "true",
  ASSISTENTE_V2_CORE: process.env.ASSISTENTE_V2_CORE === "true",
  ASSISTENTE_V2_ASSISTANT: process.env.ASSISTENTE_V2_ASSISTANT === "true",
} as const;
```

---

## Checklist de Qualidade por Componente

- [ ] TypeScript strict mode passa
- [ ] Testes unitários ≥ 90% cobertura
- [ ] Testes de integração passam
- [ ] Lint passa (`pnpm lint`)
- [ ] Build passa (`pnpm build`)
- [ ] Documentação inline (JSDoc) em funções públicas
- [ ] Logs estruturados com `traceId`
- [ ] Tratamento de erros com `Result<T, E>`
- [ ] Idempotência testada (duplicação messageId, idempotencyKey)
- [ ] Concorrência testada (lock, version conflicts)

---

## Próximos Passos

1. Executar migration `0026_conversation_state.sql`
2. Implementar Task 1: SessionManager
3. Implementar Task 2: SemanticParser v2
4. Implementar Task 3: ReferenceResolver
5. Implementar Task 4: PolicyEngine
6. Implementar Tasks 5-7: Commands + ApplicationService
7. Implementar Task 8: StateUpdater
8. Implementar Task 9: AssistenteCore + Feature Flags
8. Rodar suite completa de testes
9. Deploy em staging com feature flags
10. Validação WAR = 0