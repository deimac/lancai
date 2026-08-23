# Task 7: State Updater

## Arquivo: `modulos/assistente/agente/state-updater.ts`

## Objetivo
Atualizar `ConversationState` pós-execução: incrementa version, invalida `lastResultSet` se movimento alterado, limpa `currentEntity`.

## Contrato

```typescript
interface StateUpdater {
  updateAfterCommand(
    state: ConversationState,
    command: SimpleCommand,
    result: CommandResult
  ): ConversationState;
  
  updateAfterQuery(
    state: ConversationState,
    querySpec: QuerySpec,
    resultIds: string[]
  ): ConversationState;
  
  updateAfterConfirmation(
    state: ConversationState,
    confirmed: boolean
  ): ConversationState;
  
  updateAfterReferenceResolved(
    state: ConversationState,
    entityRef: EntityRef
  ): ConversationState;
  
  clearPendingConfirmation(state: ConversationState): ConversationState;
}
```

## Implementação

### 1. Após Comando (Create/Update/Cancel)

```typescript
function updateAfterCommand(state: ConversationState, command: SimpleCommand, result: CommandResult): ConversationState {
  const newState = { ...state, version: state.version + 1 };
  
  if (!result.success) return newState;
  
  const entityRef = result.entityRef;
  if (!entityRef) return newState;
  
  // Invalida lastResultSet se contém movimento alterado
  if (state.lastResultSet && entityRef.type === "transaction") {
    if (state.lastResultSet.ids.includes(entityRef.id)) {
      newState.lastResultSet = null; // força re-query na próxima consulta
    }
  }
  
  // Atualiza currentEntity se foi o alvo
  if (state.currentEntity?.id === entityRef.id) {
    if (command.type === "cancel_transaction") {
      newState.currentEntity = undefined; // cancelado → limpa
    } else {
      newState.currentEntity = { ...entityRef, label: buildLabel(entityRef, result.data) }; // atualiza label
    }
  }
  
  // Limpa confirmação pendente
  newState.pendingConfirmation = undefined;
  
  return newState;
}
```

### 2. Após Query

```typescript
function updateAfterQuery(state: ConversationState, querySpec: QuerySpec, resultIds: string[]): ConversationState {
  return {
    ...state,
    version: state.version + 1,
    lastResultSet: {
      ids: resultIds,
      query: querySpec,
      expiresAt: Date.now() + 10 * 60 * 1000 // 10 min
    },
    // currentEntity NÃO limpa — usuário pode referenciar "aquele" após lista
  };
}
```

### 3. Após Confirmação

```typescript
function updateAfterConfirmation(state: ConversationState, confirmed: boolean): ConversationState {
  const newState = { ...state, version: state.version + 1 };
  newState.pendingConfirmation = undefined;
  
  if (!confirmed) {
    // Usuário disse "não" → limpa operação pendente
    // (estado volta ao antes da confirmação)
  }
  
  return newState;
}
```

### 4. Após Referência Resolvida

```typescript
function updateAfterReferenceResolved(state: ConversationState, entityRef: EntityRef): ConversationState {
  return {
    ...state,
    version: state.version + 1,
    currentEntity: entityRef
  };
}
```

### 5. Limpar Confirmação Pendente

```typescript
function clearPendingConfirmation(state: ConversationState): ConversationState {
  if (!state.pendingConfirmation) return state;
  return { ...state, version: state.version + 1, pendingConfirmation: undefined };
}
```

---

## Testes Obrigatórios

| Cenário | Estado Inicial | Ação | Estado Final Esperado |
|---------|----------------|------|----------------------|
| Create transaction | lastResultSet com 3 ids | create_transaction sucesso | version++, lastResultSet=null, currentEntity=novo movimento |
| Update transaction | lastResultSet com movimento alvo | update_transaction sucesso | version++, lastResultSet=null, currentEntity atualizado |
| Cancel transaction | currentEntity = movimento | cancel_transaction sucesso | version++, lastResultSet=null, currentEntity=undefined |
| Query | — | query_transactions retorna 5 ids | version++, lastResultSet={ids:5, query, expiresAt}, currentEntity preservado |
| Confirm "sim" | pendingConfirmation set | confirmation true | version++, pendingConfirmation=undefined |
| Confirm "não" | pendingConfirmation set | confirmation false | version++, pendingConfirmation=undefined |
| Referência resolvida | — | reference resolved | version++, currentEntity=entidade |

---

## Critério de Conclusão Task 7
- [ ] `version` incrementa em **toda** mutação
- [ ] `lastResultSet` invalidado quando movimento alvo alterado/cancelado
- [ ] `currentEntity` atualizado/limpado corretamente
- [ ] `pendingConfirmation` limpo após confirmação
- [ ] Testes: 15+ casos passam
- [ ] Imutabilidade: estado original não mutado